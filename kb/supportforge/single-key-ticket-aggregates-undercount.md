---
tech: supportforge
tags: [reports, analytics, sql, client_id, organization_id, dual-key, deleted_at, undercount, zendesk-import, end_users, membership]
severity: high
---
# Ticket aggregates scoped by a single key (client_id or organization_id) silently undercount

> **Scope: this holds while the PSA is live.** Once the PSA is retired the dual-key OR stops being a safety net and starts masking drift in the canonical key, and the branching example under WRONG becomes actively lossy rather than merely incomplete. Read dual-key-scope-outlives-its-psa.md before applying any of this to a system that has already cut over.

## PROBLEM
SupportForge tickets are dual-keyed. Native tickets (created via the app/portal/email) carry `client_id` (the clients.id, shaped like `org_36856164597395`); PSA/Zendesk-imported tickets carry `organization_id` (the same id minus the `org_` prefix, e.g. `36856164597395`), often with `client_id` unset. Any report or aggregate query that scopes by only one of the two keys runs fine, returns plausible numbers, and silently misses the other population.

Observed live: the client-portal Reports page showed **Created 1 / Solved 1** while the Tickets page showed **Created 12 / Solved 13** for the same org and the same 30-day window — the report KPIs filtered `organization_id` only and missed every native ticket. Customers saw the same undercounted report in their portal.

A second compounding gap: most report queries also omitted `deleted_at IS NULL`, so soft-deleted tickets kept counting in reports while the ticket lists (which do filter it) disagreed.

**This is not limited to tickets.** `end_users` are dual-keyed the same way, so org *membership* lookups have the identical failure. `GET /organizations/:id/users` branches to one key or the other based on whether the org happens to have a `zendesk_org_id`, which means a Zendesk-synced org silently drops every contact carrying only `client_id`. Treat "which rows belong to this org" as a dual-key question everywhere, not just in ticket aggregates.

## WRONG
```sql
-- Counts only Zendesk-imported tickets; native tickets are invisible.
SELECT COUNT(*) FROM tickets
WHERE organization_id = $1
  AND created_at >= NOW() - ($2::int) * INTERVAL '1 day';
```

```typescript
// Same bug, contacts instead of tickets: branching to ONE key.
// A Zendesk-synced org drops every contact that carries only client_id.
if (org.zendesk_org_id) { where = 'u.organization_id = $1' }
else                    { where = 'u.client_id = $1' }
```

## RIGHT
```typescript
// Derive both keys from the one id and scope every aggregate by both,
// excluding soft-deleted rows. Each row matches at most one arm of the OR,
// so nothing is double-counted.
const zendeskOrgId = clientId.startsWith('org_') ? clientId.substring(4) : clientId;
const scoped = `(client_id = $1 OR organization_id = $2) AND deleted_at IS NULL`;

await db.query(
  `SELECT COUNT(*) FROM tickets
    WHERE ${scoped}
      AND created_at >= NOW() - ($3::int) * INTERVAL '1 day'`,
  [clientId, zendeskOrgId, windowDays]
);
```

```sql
-- Membership: the same OR, joined against the client row.
SELECT COUNT(*) FROM end_users u
 WHERE (u.organization_id::text = c.zendesk_org_id::text OR u.client_id = c.id)
   AND COALESCE(u.msp_id, 'NULL_MSP') = COALESCE(c.msp_id, 'NULL_MSP');
```

## NOTES
- `src/services/ticket-analytics.ts` was already correct and is the reference pattern; `client-reports.ts`, `client-reports-aggregate.ts`, and several report routes were not. Fixed in supportforge-platform v3.7.0.0, which also merged the client-portal Reports page into Tickets so there is a single query path.
- For the end_users half, the `user_counts` LATERAL in `GET /organizations` and the join in `src/services/contacts.ts` both use the correct OR form; `GET /organizations/:id/users` is the outlier still branching on one key (as of v3.24.0.0). `GET /organizations/:id/summary` was written against the OR form from the start.
- MSP-wide aggregates need the same treatment with IN-subqueries: `(client_id IN (SELECT id FROM clients WHERE msp_id=$1) OR organization_id IN (SELECT CASE WHEN id LIKE 'org_%' THEN substring(id from 5) ELSE id END FROM clients WHERE msp_id=$1))`.
- When two pages disagree on the same metric for the same tenant, diff their WHERE clauses first — key scoping and `deleted_at` are the usual suspects (see also list-tickets-includes-solved.md for status-default divergence).
- A count can be scoped correctly and still be wrong for a different reason: see org-user-counts-are-recent-requesters.md, where a one-year ticket filter makes a correctly-scoped membership count mean something else entirely.
- **Superseded in part as of 2026-08.** SupportForge's Zendesk cutover was 2026-07-04. Tickets now agree on both keys for every resolvable row (4402, 0 disagreements) and orgs created since carry no `zendesk_org_id` at all, so the OR was collapsed to `client_id` in v3.54.1.0 after migration 388 backfilled the 63 contacts that only resolved through the legacy key. The `GET /organizations/:id/users` outlier noted above was not just incomplete by then, it was hiding post-cutover contacts on 38 of 41 orgs. See dual-key-scope-outlives-its-psa.md for the measurement that licenses the collapse and the order of operations it requires.
