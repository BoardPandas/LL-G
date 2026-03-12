---
tech: ninjaone
tags: [api, filter, query, volumes, disks]
severity: high
---
# Device filter (df) parameter does not support deviceId filtering

## PROBLEM
The `df` parameter on NinjaOne query endpoints (`ninjaone_query_volumes`, `ninjaone_query_disks`) does NOT support `deviceId = X` filtering. It causes HTTP 500 every time. The same issue applies to `ninjaone_query_disks`.

## WRONG
```
# HTTP 500 -- deviceId is not a valid df filter
ninjaone_query_volumes(df="deviceId = 1255")
ninjaone_query_volumes(df="deviceId == 1255")
ninjaone_query_disks(df="deviceId = 1255")
```

## RIGHT
```
# Device-specific endpoint via ninjaone_api_call
ninjaone_api_call(method="GET", path="/device/1255/volumes")
ninjaone_api_call(method="GET", path="/device/1255/disks")

# Org-level query works with df parameter
ninjaone_query_volumes(df="org = 21")
```

## NOTES
- Working `df` values: `org = <orgId>`, `location = <locationId>`
- Non-working `df` values: `deviceId = <id>`, `deviceId == <id>` -- always HTTP 500
- For single-device queries, always use the `/device/{id}/<resource>` REST path via `ninjaone_api_call`
- The `/device/{id}/volumes` response includes: `name`, `driveLetter`, `label`, `capacity`, `freeSpace`, `fileSystem`
