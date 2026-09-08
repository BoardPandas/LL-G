---
tech: postgres
tags: [typescript, timestamps, idempotency, outbox, optimistic-locking]
severity: high
---
# JavaScript timestamps are not durable event identities or revision tokens

## PROBLEM
PostgreSQL preserves microseconds but JavaScript Date preserves milliseconds. Reading a timestamp through node-postgres and binding it back into an equality predicate silently loses precision. A scheduler's optimistic revision guard then matches no row. A notification reconciler can select the same historical event indefinitely, while distinct events can collide on a timestamp uniqueness key. Mock databases tend to use JavaScript dates on both sides and cannot reveal this.

## WRONG
```typescript
const row = (await db.query('SELECT updated_at FROM schedules WHERE id=$1', [id])).rows[0];
await db.query('UPDATE schedules SET next_run_at=$2 WHERE id=$1 AND updated_at=$3', [id, next, row.updated_at]);
// A timestamp is also not unique when two events share the same instant.
```

## RIGHT
```typescript
const row = (await db.query('SELECT updated_at::text AS revision FROM schedules WHERE id=$1', [id])).rows[0];
await db.query('UPDATE schedules SET next_run_at=$2 WHERE id=$1 AND updated_at=$3::timestamptz', [id, next, row.revision]);
// For deduplication, persist the source event ID and make it unique.
await db.query('INSERT INTO handled(event_id) VALUES($1) ON CONFLICT DO NOTHING', [event.id]);
```

## NOTES
Keep a legacy timestamp fallback only behind a partial unique index where event_id IS NULL; retaining the old universal timestamp index still rejects distinct IDs. Repeat that predicate when using an explicit ON CONFLICT column target. Use source event IDs as a tie breaker for ordered outbox delivery. Test real PostgreSQL rows with a six-digit fraction and two distinct event IDs at an identical timestamp. Windows event cursors also require normalized timestamp comparison because .NET emits seven fractional digits while a JSON Date round trip emits three. These failures were reproduced and regression-tested in SupportForge Windows automation.
