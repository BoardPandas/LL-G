---
tech: postgres
tags: [foreign-keys, locking, deadlock, concurrency, rollup]
severity: high
---
# Foreign-key inserts can deadlock a parent FOR UPDATE rollup

## PROBLEM

Two transactions append child events for the same parent, then lock that parent
with SELECT FOR UPDATE to recompute its state. Each foreign-key check already
holds KEY SHARE on the parent. Both attempt an incompatible lock upgrade and
PostgreSQL aborts one with 40P01. Serial tests and mocked queries pass; fleet
acknowledgements fail only under concurrent traffic.

## WRONG

```sql
BEGIN;
INSERT INTO job_events(job_id, state) VALUES (1, 'running');
SELECT state FROM jobs WHERE id = 1 FOR UPDATE;
UPDATE jobs SET state = 'running' WHERE id = 1;
COMMIT;
```

## RIGHT

When only non-key fields change, serialize the rollup using a lock compatible
with the existing foreign-key locks:

```sql
BEGIN;
INSERT INTO job_events(job_id, state) VALUES (1, 'running');
SELECT state FROM jobs WHERE id = 1 FOR NO KEY UPDATE;
-- Re-read execution counts after obtaining the parent lock.
UPDATE jobs SET state = 'running' WHERE id = 1;
COMMIT;
```

## NOTES

This does not authorize key changes under the weaker lock. Operations deleting
or changing referenced keys need an explicit consistent lock order before child
writes. To reproduce deterministically, use two real PostgreSQL connections,
BEGIN on each, complete both child inserts, then run the rollups concurrently.
Commit each immediately after its rollup; waiting for both rollups before either
commit introduces a different harness deadlock. Assert both transactions commit.

Observed in SupportForge's 1,000-device capacity test on PostgreSQL 18.6:
recordProgress appended an event, then refreshJobState upgraded the parent lock.
The regression failed before changing FOR UPDATE to FOR NO KEY UPDATE and passed
afterwards; all 1,000 concurrent-safe acknowledgements then completed.
