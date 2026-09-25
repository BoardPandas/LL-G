---
tech: supportforge
tags: [ninjaone, postgres, device-identity, rollout, recovery, audits]
severity: high
---
# Nullable native links hide valid NinjaOne recovery candidates

## PROBLEM

A recovery audit that joins NinjaOne only through `ninja_device_links.native_device_id` silently treats a missing canonical UUID as missing independent access. The link can still exist under the same MSP, customer, and normalized hostname. The NinjaOne sync writer can populate that hostname link without populating `native_device_id`.

A plausible list of "devices without recovery" results even when matching devices are online in NinjaOne. During the September 2026 authentication rollout, this join missed 23 matching NinjaOne records. Live verification accepted 22 and caught a serial conflict on the remaining candidate.

A cached missing serial is also inconclusive: the live NinjaOne device response can contain a serial that the synchronized row lacks.

## WRONG

```sql
SELECT d.id, l.ninja_device_id
FROM devices d
LEFT JOIN ninja_device_links l
  ON l.native_device_id = d.id
 AND l.msp_id = d.msp_id;
-- Wrong conclusion: l.ninja_device_id IS NULL means no NinjaOne recovery.
```

This collapses "unresolved relationship" into "external device absent" and skips independent recovery candidates.

## RIGHT

Treat a populated canonical link as the preferred relationship. When it is missing, discover candidates within the same MSP and customer using the current device hostname or available serial evidence. Keep discovery separate from permission to mutate:

```sql
SELECT d.id AS native_device_id,
       n.id AS ninja_device_row_id,
       n.ninja_device_id,
       n.ninja_org_id
FROM devices d
JOIN devices n
  ON n.source = 'ninja'
 AND n.msp_id = d.msp_id
 AND n.client_id = d.client_id
 AND lower(n.hostname) = lower(d.hostname)
WHERE d.source = 'agent'
  AND d.id = $1;
```

Before accepting a candidate:

1. Require one distinct external device and one active native identity in that scope. Multiple historical hostname-link rows can refer to the same external row; do not count those as multiple physical devices.
2. Reject an explicit canonical link to a different device. Do not overwrite a manually confirmed link.
3. Compare available serials and reject conflicts. Missing or placeholder serials do not establish a hardware match.
4. Read the live NinjaOne device and verify hostname, organization, and available hardware identity against the native device. Check current availability and the needed recovery capability.
5. For an enforcement rollout, exercise the authorized independent recovery action and verify a new agent process, authenticated commands, and fresh heartbeats before claiming recovery is proven.

If no safe candidate resolves, report "recovery relationship unresolved." This is different from proving no independent access exists.

## NOTES

- A hostname match is discovery evidence, not a cryptographic identity or authorization grant. Never match across customers or MSPs just because the hostname agrees.
- Service inventory can be cached while NinjaOne reports the device offline. A cached Running value is not current liveness.
- A successful device/service GET does not prove restart permission, successful recovery, or arbitrary script execution. NinjaOne application credentials may support service control while script execution remains unavailable.
- Keep audit corrections read-only. Repairing persistent link data is a separate change with its own ownership and conflict checks.
