---
tech: ninjaone
tags: [api, custom-fields, 405, definitions, Ninja-Property-Set]
severity: medium
---
# Custom field definitions cannot be created through the API (POST returns 405)

## PROBLEM
`GET /v2/device-custom-fields` lists definitions, and `PATCH /v2/device/{id}/custom-fields` writes values, so it looks like `POST /v2/device-custom-fields` should create a definition. It returns HTTP 405. Definitions are created only in the UI (Administration, Devices, Global Custom Fields). Any automation that needs a new field has a manual prerequisite step, and a script that assumes the field exists fails on the first `PATCH` or `Ninja-Property-Set` with a not-found error that looks like a typo in the field name.

## WRONG
```
POST /v2/device-custom-fields
{ "type": "TEXT", "label": "jonasWorkstationId", "name": "jonasWorkstationId", ... }
# 405 Method Not Allowed
```

## RIGHT
1. Create the field in the UI: type, label, and the three permissions. For a field written by scripts and read by API: Technician Read Only (or Editable), Automations Read/Write, API Read/Write.
2. Resolve the API name at runtime instead of hard-coding it. Newer fields get a lowercased `name` (`techassistantscript`), older ones keep camelCase (`purchaseDate`). Match on `label` case-insensitively and use the returned `name`:
```powershell
$defs = @(Invoke-RestMethod "$base/v2/device-custom-fields" -Headers $h)
$def  = @($defs | Where-Object { $_.label -ieq 'jonasWorkstationId' })
if ($def.Count -eq 0) { throw 'create the field in the NinjaOne UI first' }
$apiName = $def[0].name
Invoke-RestMethod "$base/v2/device/$id/custom-fields" -Method PATCH -Headers $h -ContentType 'application/json' -Body (@{ $apiName = 'FM' } | ConvertTo-Json)
```
3. Read back after writing. `GET /v2/device/{id}/custom-fields` returns only fields that have a value.

## NOTES
- On the endpoint, `Ninja-Property-Set <name> <value>` needs the field's Automations permission to be Read/Write; otherwise it errors without changing anything.
- `Ninja-Property-Set` is backed by `ninjarmm-cli.exe`, so it only works under the NinjaOne agent. Wrap it in try/catch and report, rather than letting a field write fail the script's main job.
