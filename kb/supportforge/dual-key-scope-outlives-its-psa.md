---
tech: supportforge
tags: [dual-key, client_id, organization_id, zendesk, psa-migration, canonical-key, data-migration, routing, sql, msp_id, silent-drift]
severity: high
---
# The dual-key org scope outlives the PSA that justified it, and then starts hiding rows

## PROBLEM
`single-key-ticket-aggregates-undercount.md` prescribes scoping every org query with `(client_id = $1 OR organization_id = $2)`. That is correct **while the PSA is writing rows**. Once the PSA is retired the same pattern inverts from a safety net into a source of silent wrong output, in three escalating ways.

**1. Queries that BRANCH on the legacy key drop the new population entirely.** Orgs created after the cutover have no `zendesk_org_id` at all, and contacts created after it carry only `client_id`. Any code shaped `if (org.zendesk_org_id) filter by organization_id else filter by client_id` therefore filters a Zendesk-era org by a column its newest members never populate. Measured on production: this hid post-cutover contacts on 38 of 41 orgs, on both `GET /organizations/:id/users` and the Persona Lens overview. The org's own user list did not contain people whose profile page named that org.

**2. The OR masks drift in the canonical pointer.** This is the expensive one. A contact whose `client_id` is stale still resolves correctly on every screen that ORs, because the legacy key covers for it. The drift is therefore invisible until some code path reads `client_id` alone. Inbound email routing is exactly that path, and it had only an `IS NOT NULL` test on the value, so it accepted a stale pointer at face value.

Worked example: a contact carried `organization_id = 36856140539027` (correct) and `client_id = 'default'` (a legacy catch-all row with `msp_id IS NULL`). Every display join carries `AND c.msp_id = u.msp_id`, which an unowned row can never satisfy, so those screens fell through to the legacy key and showed the right org. Routing had no such guard, so 27 tickets were filed against a client that is not a customer, absent from that org's reporting and ticket counts. It presented as a rendering bug and survived weeks of being looked at, because every screen anyone thought to check was one of the ones that ORs.

**3. It hides how far the real migration still has to go.** The OR keeps the UI looking right, so nobody counts the rows that only resolve through the dead key. There were 63.

## WRONG
```typescript
// Branching on the legacy key. Post-cutover contacts carry only client_id,
// so a Zendesk-era org silently loses every member added since the cutover.
if (org.zendesk_org_id) { where = 'u.organization_id = $1'; param = org.zendesk_org_id; }
else                    { where = 'u.client_id = $1';       param = org.id; }
```

```typescript
// Trusting a canonical pointer without proving it resolves. 'default' is a
// non-null string, so this returns a client that is not a customer and never
// reaches the domain-mapping fallback below it.
const u = await db.query(
  `SELECT eu.client_id FROM end_users eu
    WHERE lower(eu.email) = $1 AND eu.msp_id = $2 AND eu.client_id IS NOT NULL LIMIT 1`,
  [fromEmail, mspId]
);
if (u.rows[0]?.client_id) return { clientId: u.rows[0].client_id, via: 'contact' };
```

## RIGHT
```sql
-- Step 1: MEASURE before collapsing anything. Resolve every row BOTH ways and
-- diff. This is the query that licenses the change; do not skip to the edit.
SELECT count(*)                                                     AS rows,
       count(*) FILTER (WHERE old_org IS DISTINCT FROM new_org)     AS disagree,
       count(*) FILTER (WHERE old_org IS NOT NULL AND new_org IS NULL) AS would_regress
FROM (
  SELECT (SELECT c.id FROM clients c
           WHERE (c.zendesk_org_id::text = u.organization_id::text OR c.id = u.client_id)
             AND c.msp_id = u.msp_id LIMIT 1) AS old_org,
         (SELECT c.id FROM clients c
           WHERE c.id = u.client_id AND c.msp_id = u.msp_id LIMIT 1) AS new_org
  FROM end_users u
) t;
-- would_regress is the backfill work. Only when it is 0 is the collapse a no-op.
```

```typescript
// Step 2: make the canonical pointer prove itself by JOINing, not by being
// non-null. An unowned catch-all row (msp_id IS NULL) fails the MSP guard and
// falls through to the next resolution strategy instead of being trusted.
const u = await db.query(
  `SELECT c.id
     FROM end_users eu
     LEFT JOIN end_user_emails al ON al.end_user_id = eu.id
     JOIN clients c ON c.id = eu.client_id AND c.msp_id = eu.msp_id
    WHERE (lower(eu.email) = lower($1) OR lower(al.email) = lower($1))
      AND eu.msp_id = $2 AND c.status <> 'deleted'
    LIMIT 1`,
  [fromEmail, mspId]
);
if (u.rows[0]?.id) return { clientId: u.rows[0].id, via: 'contact' };
```

## NOTES
- **Order of operations is not optional.** Backfill the canonical key first, deploy the collapsed queries second. Between those steps the system is correct either way; in the other order every row that only resolved through the dead key loses its org on every screen at once. Roll back in reverse for the same reason.
- **Verify with a three-run diff, not with "the numbers went up."** Run the measurement before the migration, after the migration, and after the deploy. Run 3 must be byte-identical to run 2: on corrected data the code change is by definition a no-op, so any difference means a query still leans on the dead key.
- **A per-row DEFAULT is not a null, and outlives the migration that made the column nullable.** `tickets.client_id` was `NOT NULL DEFAULT 'default'` for years, so "unknown org" and "the org literally named Default Client" were the same value. A later migration made the column nullable but nothing drained the sentinel, so both meanings coexisted indefinitely. When a nullable column replaces a sentinel, drain the sentinel in the same change or it becomes permanent.
- **An unowned row behaves differently in guarded and unguarded joins, and that is the whole bug.** A `clients` row with `msp_id IS NULL` is skipped by every join carrying `AND c.msp_id = u.msp_id` and matched by every join without it. When two screens disagree about the same tenant, diff the join **guards** before the SELECT lists.
- **Collapsing an OR in a hand-written query is not a local edit.** Dropping `$2` from a WHERE clause leaves an unused bind, which Postgres rejects outright (`bind message supplies 3 parameters, but prepared statement requires 2`), so every later placeholder must be renumbered. Where a file shares a `$1..$4` prologue across many queries, that renumbering is its own change; leaving the OR in place there is legitimate, because a branch that matches nothing is harmless once `disagree` is 0.
- Amends `single-key-ticket-aggregates-undercount.md`: that entry's advice holds while the PSA is live, and its `WRONG` branching example is the one that becomes actively lossy afterwards. Read them together.
- SupportForge specifics as of 2026-08: last PSA write 2026-07-04; tickets agreed on both keys for all 4402 resolvable rows with 0 disagreements, so only `end_users` needed a backfill (63 rows). 38 of 41 clients satisfied `id = 'org_' || zendesk_org_id`, making the legacy column structurally redundant. Fixed in supportforge-platform v3.54.1.0 with migration 388.
