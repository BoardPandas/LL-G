---
tech: postgres
tags: [retention, partitioning, multi-tenant, legal-holds, deletion]
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

## WRONG

```sql
-- A 30-day tenant shares each daily partition with a 365-day tenant.
SELECT MAX(retention_days) FROM tenant_retention;
-- Dropping only partitions older than 365 days leaves both tenants' rows there.
```

## RIGHT

Enforce each tenant's retention with bounded row deletion, including rows in the
default partition. Preserve held rows and any data still needed by downstream
rollups. Reclaim a shared partition only after checking emptiness while holding
an exclusive lock through its drop:

```sql
BEGIN;
LOCK TABLE metric_points_20200101 IN ACCESS EXCLUSIVE MODE;
SELECT EXISTS(SELECT 1 FROM metric_points_20200101 LIMIT 1) AS occupied;
-- Only if occupied is false, on this same connection and transaction:
DROP TABLE metric_points_20200101;
COMMIT;
```

Use catalog-derived, validated identifiers for dynamic partition names. Serialize
hold/policy changes with row and object deletion. Expose expired and overdue
counts so a bounded sweep's success is not mistaken for a cleared backlog.

## NOTES

SupportForge RMM-041 tests the real PostgreSQL implementation: each of four metric
resolutions removes a row just before its tenant cutoff, preserves a row exactly
at the cutoff and another tenant's row, retains unrolled data, and refuses to
drop a populated expired partition. Test stored data and boundaries, not merely
successful policy saves or cleanup completion status.
