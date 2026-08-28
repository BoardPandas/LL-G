---
tech: postgres
tags: [on-conflict, upsert, partial-index, unique-index, arbiter, soft-delete, drizzle, orm]
severity: medium
---
# A partial unique index cannot arbitrate ON CONFLICT unless the statement repeats its WHERE

## PROBLEM
Soft-delete schemas reach for a PARTIAL unique index -- `UNIQUE (a, b) WHERE
deleted_at IS NULL` -- so a soft-deleted row does not block re-adding the same
key. That index is invisible to `ON CONFLICT (a, b)`: Postgres will only pick a
partial index as the arbiter if the statement repeats the index predicate, so
the insert raises 42P10, `there is no unique or exclusion constraint matching
the ON CONFLICT specification`.

Three things make it cost more than it should:

1. **The error names the wrong problem.** `\d table` and `pg_indexes` both show
   the index, plainly marked UNIQUE and covering exactly the columns you listed.
   "No unique constraint matching" reads as *the index is missing*, sending you
   to hunt a migration that never went out, when the index is present and the
   statement is what is incomplete.
2. **The ORM hides the predicate behind a misleading name.** On drizzle-orm the
   option is `where` inside `onConflictDoNothing({ target, where })` -- and it is
   NOT a row filter, which is what that name means everywhere else in the query
   builder. It is the index predicate. `targetWhere`, which is what you would
   guess and what some docs show, does not exist on 0.45 and fails type-check.
3. **It only fires when a row is actually inserted**, so it hides in whatever
   code path is rarest. Found in a multi-stage seed script: the statement had
   been wrong since the partial index shipped, but nothing re-ran that stage
   until a full rebuild, which then aborted midway and left the tenant half
   populated -- inventory and invoices written, tickets and commissions not.

## WRONG
```sql
CREATE UNIQUE INDEX conn_org_service_uniq
  ON connections (org_id, service_id) WHERE deleted_at IS NULL;

-- 42P10, even though that index exists and is unique on exactly these columns
INSERT INTO connections (id, org_id, service_id, name)
VALUES ($1, $2, $3, $4)
ON CONFLICT (org_id, service_id) DO NOTHING;
```

```ts
// drizzle-orm: same failure, and `targetWhere` is not a real option here
await db.insert(connections).values(row)
  .onConflictDoNothing({ target: [connections.orgId, connections.serviceId] });
```

## RIGHT
```sql
INSERT INTO connections (id, org_id, service_id, name)
VALUES ($1, $2, $3, $4)
ON CONFLICT (org_id, service_id) WHERE deleted_at IS NULL DO NOTHING;
```

```ts
// `where` here is the INDEX PREDICATE, not a row filter
import { isNull } from "drizzle-orm";

await db.insert(connections).values(row)
  .onConflictDoNothing({
    target: [connections.orgId, connections.serviceId],
    where: isNull(connections.deletedAt),
  });
```

## NOTES
Sibling of [ON CONFLICT must echo the exact expression of an expression-based
unique index](on-conflict-expression-index.md) -- same 42P10, same cause (the
arbiter must reproduce whatever makes the index special), different trigger:
expressions there, a predicate here. A table can need both at once.

Targetless `ON CONFLICT DO NOTHING` sidesteps the arbiter entirely and is the
right call when any unique violation should be swallowed. It is NOT equivalent:
it also swallows violations of every other unique index on the table, which is
usually too broad, and `DO UPDATE` cannot use it at all -- that always requires
an explicit matching arbiter.

Grep for this rather than waiting to hit it. Any `ON CONFLICT` whose target
columns match a partial index is already wrong; the ones in seed, backfill and
reconciliation scripts are the ones that will not have run recently:

```sql
select indexname, indexdef from pg_indexes
where schemaname = 'public' and indexdef like '%UNIQUE%' and indexdef like '%WHERE%';
```

Beware the write that aborts partway. If the failing statement sits in a
multi-step script that is not wrapped in one transaction, the run dies with
earlier stages already committed, and re-running is only safe if every stage is
genuinely idempotent.
