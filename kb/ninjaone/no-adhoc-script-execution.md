---
title: NinjaOne API does not support ad-hoc script execution
severity: HIGH
tags: [ninjaone, scripting, api, rmm]
---

## Problem

The NinjaOne REST API v2 `POST /device/{id}/script/run` endpoint does **not** accept inline script content. Passing `scriptContent`, `script`, `body`, or `scriptBody` fields always returns HTTP 400 with no useful error detail.

The `ninjaone_run_script` MCP tool exposes a `scriptContent` parameter, but it does not work -- the underlying API rejects it.

## Root Cause

NinjaOne v2 only runs pre-saved scripts referenced by their integer ID. There is no REST endpoint to create or upload scripts -- they must be created through the NinjaOne UI (Administration > Library > Scripting).

## BAD

```python
# Always returns HTTP 400
ninjaone_run_script(
    deviceId=1255,
    scriptContent="Write-Output 'hello'",
    scriptType="POWERSHELL",
    runAs="SYSTEM"
)
```

```json
// Also HTTP 400
POST /device/1255/script/run
{"type": "POWERSHELL", "body": "Write-Output 'hello'", "runAs": "SYSTEM"}
```

## GOOD

```python
# Use a saved script ID
ninjaone_run_script(
    deviceId=1255,
    scriptId=42,
    parameters="-Preview",
    runAs="SYSTEM"
)
```

```json
// Correct raw API format
POST /device/1255/script/run
{"type": "SCRIPT", "id": 42, "parameters": "-Preview", "runAs": "SYSTEM"}
```

## Workflow for Skills That Need Custom Scripts

1. Get available scripts: `GET /device/{id}/scripting/options`
2. Search returned `scripts[]` by name for your script
3. If not found: prompt user to create it in NinjaOne UI, then return
4. If found: use the integer `id` field with `ninjaone_run_script(scriptId=...)`

There is also no REST API to list or create scripts globally -- `GET /scripting/scripts` and `POST /scripting/scripts` both return 404.
