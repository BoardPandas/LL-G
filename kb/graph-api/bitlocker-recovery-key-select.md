---
tech: graph-api
tags: [bitlocker, recoveryKeys, informationProtection, select, app-only, silent-omission]
severity: medium
---
# BitLocker recovery key value is silently omitted unless $select=key is requested ALONE

## PROBLEM
Reading a BitLocker recovery key value via `GET /informationProtection/bitlocker/recoveryKeys/{id}` requires `$select=key` -- the `key` property is never returned by default. The non-obvious trap: if you combine `key` with ANY other property in the `$select` (e.g. `$select=key,createdDateTime,volumeType,deviceId`), Graph returns HTTP 200 with the metadata but the `key` field is **silently dropped** -- no error, no warning. It reads exactly like "this device has no escrowed key," which sends you chasing a non-problem. Requesting `$select=key` by itself returns the actual 48-digit recovery password.

Bonus finding: app-only certificate auth (e.g. an app-only Graph connection) CAN retrieve the key value, despite Microsoft docs implying the operation is delegated-only, as long as the app registration holds a BitLocker key read role. The metadata-list call (`GET .../recoveryKeys`) works too and returns per-device entries you can match on `deviceId` (the Entra device object's `deviceId` GUID, from `GET /devices?$filter=displayName eq '<hostname>'`).

## WRONG
```http
GET /informationProtection/bitlocker/recoveryKeys/{id}?$select=key,createdDateTime,volumeType,deviceId
# HTTP 200 -- but "key" is missing from the response. Looks like no key exists.
# {
#   "id": "...", "createdDateTime": "...", "volumeType": "1", "deviceId": "..."
#   <-- no "key" property
# }
```

## RIGHT
```http
GET /informationProtection/bitlocker/recoveryKeys/{id}?$select=key
# HTTP 200 with the actual key:
# {
#   "id": "...", "createdDateTime": "...", "volumeType": "1", "deviceId": "...",
#   "key": "146542-106788-226347-343596-464057-200849-113652-525514"
# }
# The other properties still come back alongside key -- you don't lose them by selecting key alone.
```

## NOTES
- Full flow: resolve the Entra device (`GET /devices?$filter=displayName eq '<hostname>'` -> grab `deviceId`), list keys (`GET /informationProtection/bitlocker/recoveryKeys`, paginate via `@odata.nextLink`), match the entry whose `deviceId` equals that GUID, then fetch its key with `$select=key` alone.
- `volumeType: "1"` is the OS/boot (C:) volume -- the one needed for a recovery-screen unlock.
- The on-screen BitLocker Recovery Key ID matches the first 8 chars of the escrow record's `id`.
- Retrieving the key writes an audit-log event in Entra; treat the value as sensitive.
- Reproduced 2026-07-27 pulling the key for device WBA-3BRX284 (Woodberry Associates tenant) via app-only cert Graph.
