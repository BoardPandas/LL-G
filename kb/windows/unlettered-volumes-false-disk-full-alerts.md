---
tech: windows
tags: [windows, cim, disk-space, rmm, inventory, postgres]
severity: high
---
# Unlettered volumes can produce false disk-full health alerts

## PROBLEM

Win32_Volume inventory includes hidden partitions as well as lettered drives.
Filtering only on DriveType = fixed still includes unlettered volumes. Taking
the maximum percent used across that inventory can label a healthy endpoint
unmanageable while its system-volume heartbeat shows plenty of free space.

Observed in SupportForge: a hidden 96 MB FAT32 volume reported zero free bytes,
driving a 100% disk warning and a blocked-executor state while C: was only about
20% used. Fleet health and the device overview were measuring different scopes.
The misleading warning also propagated into cached fleet counts.

## WRONG

```sql
SELECT MAX((capacity_bytes - free_bytes)::double precision / capacity_bytes * 100)
FROM rmm_volumes
WHERE device_id = $1 AND retired_at IS NULL AND drive_type = 'fixed';
```

## RIGHT

When the product's operational scope is lettered Windows drives, apply that
scope before aggregating, and use the same predicate for hardware lists and
storage summaries. Keep full collected inventory separately if needed.

```sql
SELECT MAX(CASE WHEN capacity_bytes > 0
  THEN (capacity_bytes - free_bytes)::double precision / capacity_bytes * 100
END)
FROM rmm_volumes
WHERE device_id = $1 AND retired_at IS NULL AND drive_type = 'fixed'
  AND rtrim(mount_point, '/' || chr(92)) ~ '^[A-Za-z]:$';
```

## NOTES

- Include secondary lettered drives such as D:, not just the boot drive.
- In a cross-platform fleet, retain Unix absolute mount paths separately;
  requiring a Windows drive letter everywhere would erase Linux/macOS storage.
- No matching volume means unknown usage, not zero usage.
- A reported percentage alone does not identify the affected volume. Distinguish
  the system-volume heartbeat from the highest usage among operational drives.
- Regression tests should cover hidden-full plus C:-healthy, a full secondary
  lettered drive, retired/removable exclusions, no usable volumes, and Unix paths.
- Refresh persisted health after changing the aggregate. Filtering the visible
  list alone does not repair cached low-disk counts or executor states.
