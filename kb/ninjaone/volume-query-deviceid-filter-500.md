---
title: ninjaone_query_volumes with deviceId filter returns HTTP 500
severity: HIGH
tags: [ninjaone, volumes, disks, api, rmm]
---

## Problem

Using `ninjaone_query_volumes` (or `ninjaone_query_disks`) with a `deviceId = X` device filter always returns HTTP 500. No variation of the syntax works:

```python
# All return HTTP 500
ninjaone_query_volumes(df="deviceId = 1255")
ninjaone_query_volumes(df="deviceId == 1255")
ninjaone_query_disks(df="deviceId = 1255")
```

## Root Cause

The `df` (device filter) parameter on NinjaOne query endpoints does not support single-device filtering by `deviceId`. It only works for broader filters like org or location.

## BAD

```python
# HTTP 500 -- do not use
ninjaone_query_volumes(df="deviceId = 1255")
```

## GOOD

```python
# Use the device-specific endpoint via ninjaone_api_call
ninjaone_api_call(method="GET", path="/device/1255/volumes")

# For org-level overview (this works fine)
ninjaone_query_volumes(df="org = 21")
```

## Device Volumes Response Fields

The `/device/{id}/volumes` response includes:
`name`, `driveLetter`, `label`, `deviceType`, `fileSystem`, `capacity`, `freeSpace`, `serialNumber`

Calculate used space as `capacity - freeSpace`. Calculate `% free` as `freeSpace / capacity * 100`.
