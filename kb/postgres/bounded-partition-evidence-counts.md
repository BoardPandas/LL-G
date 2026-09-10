---
tech: postgres
tags: [partitioning, aggregation, parallel-query, retention, evidence, statement-timeout]
severity: high
---
# Exact evidence counts can time out on a partitioned parent

## PROBLEM
A retention evidence collector counted an entire partitioned telemetry parent while
calling a volatile, parallel-unsafe legal-hold guard inside an aggregate FILTER.
Small tenants succeeded; the largest repeatedly hit the application's 30-second
statement timeout and never produced evidence. The guard disabled parallel plans.
Removing it from the aggregate helped five-minute rollups (3.5s to 0.53s), but the
minute parent still exceeded a 15-second diagnostic cap. Do not conclude that a
single planner change fixes the workload without testing the largest tenant.

## WRONG
```sql
SELECT count(*),
  count(*) FILTER (WHERE bucket_at < $2 AND NOT governance_held($1,'telemetry'))
FROM metric_points WHERE msp_id = $1;
```
Running this inside a privileged audit transaction also holds the audit lock for
the duration of an unbounded historical scan. Raising the global timeout hides
both problems; planner row estimates are not exact compliance evidence.

## RIGHT
```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- Read policy, legal holds and transaction_timestamp() once in this snapshot.
-- Enumerate physical leaves with pg_partition_tree, including DEFAULT.
-- Count each catalog-quoted leaf separately with bound tenant/cutoff/hold values:
SELECT count(*)::text,
  count(*) FILTER (WHERE bucket_at < $2 AND NOT $3::boolean)::text
FROM "public"."metric_points_20260908" WHERE msp_id = $1;
COMMIT;
```
Combine exact counts with bigint arithmetic and preserve strings in JSON. Aggregate
minimum/maximum timestamps across leaves. Keep the long read outside audit and
cleanup locks, then write immutable evidence in a short audited transaction with
an explicit inventory snapshot time. Protect enumeration against concurrent DDL;
fail and retry rather than silently omit a missing relation. Nonpartitioned stores
need a fallback to the table itself.

## NOTES
Measured with the actual collector against 53.2 million minute rows plus coarser
rollups: the full tenant inventory completed in 8.3s, with its slowest statement
1.1s. These are workload measurements, not universal bounds: a growing DEFAULT
partition or oversized leaves can still require further work. Log the specific
store/partition on failure. Do not weaken a volatile destructive-write guard merely
to optimize reporting; take a consistent read of hold state instead.
Regression tests should include range and DEFAULT rows, another tenant, active
and released holds, empty stores, exact boundaries and snapshot consistency.
