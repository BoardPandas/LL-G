---
tech: postgres
tags: [migration, dry-run, rollback, foreign-key, locks, temp-table, production]
severity: high
---
# A rolled-back dry run holds the FK's lock on the parent table for as long as the job runs

## PROBLEM
Validating a new migration plus the job that writes to it against production inside
`BEGIN … ROLLBACK` persists nothing, but it is not free. `REFERENCES parent(id)` takes a
SHARE ROW EXCLUSIVE lock on the parent, held until the transaction ends. If you run the
whole job (seconds, across every tenant) in that same transaction, every INSERT, UPDATE
or DELETE on the parent (often `tenants`/`msps`) blocks for the entire run. The dry run
reports success, and the stall appears only as slow writes elsewhere.

## WRONG
```sql
BEGIN;
CREATE TABLE snapshots (msp_id text NOT NULL REFERENCES msps(id), ...);
-- run the capture job: ~5-20 s of queries, msps write-locked throughout
ROLLBACK;
```

## RIGHT
```sql
-- (a) Validate the DDL alone; the lock lasts milliseconds.
BEGIN; SET LOCAL lock_timeout = '2s';
CREATE TABLE snapshots (msp_id text NOT NULL REFERENCES msps(id), ...);
ROLLBACK;
-- (b) Run the job against a temp copy without the FK. pg_temp is searched first,
--     so the code's unqualified table name resolves to it, and no parent lock is taken.
BEGIN;
CREATE TEMP TABLE snapshots (msp_id text NOT NULL, ...);
-- run the real job code on this connection, assert results
ROLLBACK;
```

## NOTES
Strip the migration file's own BEGIN/COMMIT first (see nested-begin-commit-ends-outer-transaction).
Afterwards, confirm with `to_regclass('public.snapshots')` that nothing persisted. Used for
SupportForge migration 511: 25 scopes in about 5 s, an idempotent upsert on rerun, and no
lock on `msps`.
