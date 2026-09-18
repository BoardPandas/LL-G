---
tech: postgres
tags: [retention, partitioning, multi-tenant, legal-holds, deletion, disk-space]
severity: high
---
# A shared partition maximum does not enforce tenant deletion deadlines

## PROBLEM

Expiring a shared time partition only after MAX(retention_days) protects the
longest-retained tenant, but silently preserves shorter-retained tenants beyond
their deletion schedule. The policy editor can save correctly and every cleanup
job can succeed while a tenant's retention promise is never enforced. Switching
to MIN would delete another tenant's data early. Row DELETE triggers also do not
protect held rows from DROP TABLE.

**The obvious resolution -- bounded per-tenant row deletion, then drop the
partition once it is empty -- reclaims nothing if the sweep cannot outrun
ingest, and that failure is invisible.** Both halves report success forever: the
sweep deletes its full batch every pass, and the drop correctly declines a
partition that is not empty. Nothing errors, nothing is logged as unhealthy, and
disk grows without bound.

Do the arithmetic before trusting the pattern. Measured on a live RMM fleet:
ingest 5.9M rows/day against a sweep bounded to 10,000 rows per tenant per store
per hourly pass across 3 tenants = 720k rows/day, or **12% of ingest**. No
partition ever reached empty, so none was ever dropped in three weeks. Postgres
went 2 GB -> 38 GB, dead linear. `DELETE` never returns disk to the OS in any
case -- it manufactures dead tuples and WAL and hands autovacuum a race it also
loses -- so only the DROP reclaims, and the DROP was gated on the thing that
could not happen.

On a host that meters memory by usage with cgroup accounting (Railway, most
container platforms), page cache counts, so **the memory line item tracks the
table**: $14.72 for a whole month became $40.25 in ten days with no workload
change. A monotonically climbing memory bill with flat traffic is a disk-growth
question, not a leak.

## WRONG

```sql
-- A 30-day tenant shares each daily partition with a 365-day tenant.
SELECT MAX(retention_days) FROM tenant_retention;
-- Dropping only partitions older than 365 days leaves both tenants' rows there.
```

```sql
-- And this, which looks like the fix but is the stall: the partition is only
-- dropped once empty, and the only thing emptying it is a bounded sweep that
-- clears a fraction of what arrives. Both halves "succeed" indefinitely.
LOCK TABLE metric_points_20200101 IN ACCESS EXCLUSIVE MODE;
SELECT EXISTS(SELECT 1 FROM metric_points_20200101 LIMIT 1) AS occupied;
-- occupied is true forever; nothing is ever dropped.
```

## RIGHT

Keep bounded per-tenant row deletion for what only it can do -- unpartitioned
stores, DEFAULT partitions, and any tenant whose own retention is *shorter* than
the maximum. But make the bulk reclamation a partition drop gated on a horizon,
not on emptiness. Past MAX(retention) no tenant has a claim on a single row in
the partition, so emptiness adds nothing there; what it was standing in for is
legal holds, which must be checked explicitly because DDL fires no row trigger.

Three gates, and a drop needs all of them:

```sql
-- 1. retention: past the longest window ANY tenant is entitled to.
--    Resolve per tenant -- see coalesce-max-over-per-tenant-config.md, which is
--    the bug that makes this gate silently too short.
SELECT COALESCE(MAX(COALESCE(r.retention_days, $1)), $1)::int
  FROM tenants t LEFT JOIN tenant_retention r ON r.tenant_id = t.id;

-- 2. watermark: the downstream rollup has consumed the partition. Compare the
--    partition's UPPER bound, which is the row-level `bucket_at < watermark`
--    restated for a whole partition.
SELECT rolled_up_through FROM rollup_watermarks WHERE resolution = $1;

-- 3. backfill floor: clients may still write into a recent period.
--    MAX_BACKFILL + one partition width, because a one-period lookback does not
--    itself cover a backfill window longer than one period.
```

Then, per partition, in one transaction:

```sql
SET LOCAL lock_timeout = '3s';
SELECT pg_try_advisory_xact_lock(<ns>, <id>);   -- try, never blocking: see NOTES
SELECT 1 FROM legal_holds
 WHERE category IN ('all','telemetry') AND released_at IS NULL LIMIT 1;
-- re-validate from the catalog that the name is still a partition of THIS parent
SELECT c.reltuples FROM pg_class c
  JOIN pg_inherits i ON i.inhrelid = c.oid
  JOIN pg_class p ON p.oid = i.inhparent
 WHERE c.relname = $1 AND p.relname = $2;
-- audit rows for every affected tenant go here, BEFORE the drop
DROP TABLE "metric_points_20200101";
COMMIT;
```

Cap drops per pass (4 is ample when a day produces one partition). That is blast
radius, not throughput: a miscomputed horizon costs four partitions before the
next pass rather than the whole history. Use `reltuples`, never `COUNT(*)` --
counting a 1.4 GB partition under the lock the DROP is about to need is seconds
of blocked ingest to produce a number nothing decides on.

Report *why* nothing was dropped. "Nothing was due" and "everything is blocked"
are opposite states that both render as `dropped: 0`.

## NOTES

Classify `55P03` (lock_not_available), `40P01` (deadlock_detected) and `42P01`
(undefined_table) as skips, not failures -- the next pass is the retry.

The advisory lock must be `pg_try_advisory_xact_lock`, never the blocking form,
when a hold-guard trigger also takes it: the sweep's DELETE holds RowExclusive on
the table and *then* takes the advisory lock from inside the trigger, while the
drop path wants the opposite order. That is an ABBA deadlock between two jobs
that both run hourly. See ddl-bypasses-row-triggers.md.

De-phase the partition job from any hourly evidence/inventory job that takes
ACCESS SHARE on the same parents and holds it through a per-leaf COUNT(*); in
phase they collide on the hour, forever.

Test stored data and boundaries, not policy saves or completion status. And
mutation-test the gates: a pass-level hold check masks a missing in-transaction
one, so removing the check that closes the race can leave every test green.
