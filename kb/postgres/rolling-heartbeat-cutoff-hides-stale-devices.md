---
tech: postgres
tags: [fleet, pagination, filters, aggregates, time-windows, left-join]
severity: high
---
# A rolling heartbeat cutoff silently makes stale-device views impossible

## PROBLEM

A fleet directory reads only heartbeats from the past 24 hours, then offers an Offline > 24h view over that result. The view is permanently empty even though the tenant owns older devices. A separate health summary that starts from device inventory reports a different fleet total. HTTP 200, valid types, and tests containing only recent devices all conceal the contradiction. Applying the view to one loaded page adds a second silent omission.

The directory's base population must include every entity its supported filters can select. Telemetry age describes a device; it should not silently determine whether the device exists in inventory.

## WRONG

```sql
WITH fleet AS (
  SELECT * FROM agent_heartbeats
  WHERE ts > now() - interval '24 hours'
)
SELECT * FROM fleet
WHERE ts < now() - interval '24 hours';
```

## RIGHT

```sql
WITH fleet AS (
  SELECT d.id, h.ts AS last_seen
  FROM devices d
  JOIN clients c ON c.id = d.client_id
  LEFT JOIN LATERAL (
    SELECT ah.ts
    FROM agent_heartbeats ah
    WHERE ah.device_id = d.id
      AND ah.client_id = d.client_id
      AND ah.retired_at IS NULL
    ORDER BY ah.ts DESC NULLS LAST, ah.id DESC
    LIMIT 1
  ) h ON true
  WHERE d.msp_id = $1 AND c.msp_id = $1
    AND d.source = 'agent'
), filtered AS (
  SELECT * FROM fleet
  WHERE last_seen IS NULL
     OR last_seen < now() - interval '24 hours'
)
SELECT * FROM filtered
ORDER BY last_seen DESC NULLS LAST, id
OFFSET $2 LIMIT $3;
```

## NOTES

- Define whether never-seen devices belong in the offline view and show that distinction in the UI.
- Count the canonical scoped population and the selected view explicitly. Apply view conditions before pagination; never use loaded rows as fleet totals.
- Test with more than one page, a device older than the cutoff, a device without a heartbeat, retired reports, and mismatched tenant ownership. Assert the actual rows and totals against PostgreSQL.
- If a summary spans all views but shares organization/search/chip scope, label that scope. Overlapping issue counts must not be summed into an affected-device total.
- Confirmed in SupportForge's Devices directory: the old heartbeat query excluded everything the Offline > 24h view could match. The replacement was verified against session-local tables using the real checked-in PostgreSQL column definitions.
