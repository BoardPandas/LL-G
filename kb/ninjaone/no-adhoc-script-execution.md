---
title: Script execution has TWO separate blockers - inline content (400) and a key without user context (403)
severity: HIGH
tags: [ninjaone, scripting, api, rmm, oauth, client-credentials, permissions]
---

## Problem

`POST /device/{id}/script/run` can fail for two unrelated reasons. They are easy to confuse, and the second one is far more consequential because **no script can be run at all, saved or otherwise**.

**Blocker 1 — inline script content (HTTP 400).** The endpoint does not accept inline script bodies. Passing `scriptContent`, `script`, `body`, or `scriptBody` returns HTTP 400 with no useful detail. NinjaOne v2 only runs pre-saved scripts referenced by integer ID; there is no REST endpoint to create or upload one.

**Blocker 2 — access key has no user context (HTTP 403).**

```
403: Access key does not have user context which is required for this request
```

A token minted with the **client_credentials** grant (the usual machine-to-machine integration key) cannot run scripts *at all*. This is not a scope/permission you can add to the key — NinjaOne requires the token to carry a user identity, which only the **authorization_code** grant produces.

The trap: the obvious workaround for Blocker 1 is "fine, use a saved script ID." **That fails identically with 403.** Both of these return the same error:

```python
ninjaone_run_script(deviceId=1781, scriptContent="...", scriptType="POWERSHELL")  # 403
ninjaone_run_script(deviceId=1781, scriptId=229, runAs="SYSTEM")                  # 403 — same
```

So on a client-credentials integration, remote script execution is simply unavailable, and the saved-script workflow below is moot until the key is re-issued.

## BAD

```python
# Blocker 1: inline content -> 400 (even with a user-context token)
ninjaone_run_script(deviceId=1255, scriptContent="Write-Output 'hello'",
                    scriptType="POWERSHELL", runAs="SYSTEM")

# Blocker 2: saved script ID, but the key is client_credentials -> 403
# Do NOT read this 403 as "wrong script id" or "device offline"
ninjaone_run_script(deviceId=1255, scriptId=42, runAs="SYSTEM")
```

## GOOD

```python
# Requires a token from the authorization_code grant (see oauth-authorization-code-flow.md)
ninjaone_run_script(deviceId=1255, scriptId=42, parameters="-Preview", runAs="SYSTEM")
```

```json
// Correct raw API format
POST /device/1255/script/run
{"type": "SCRIPT", "id": 42, "parameters": "-Preview", "runAs": "SYSTEM"}
```

## What still works WITHOUT user context

Do not conclude the whole API is read-only when you hit the 403. Plenty of state-changing endpoints work fine with a client_credentials key, and one of them is often enough to unblock you:

```json
POST /device/{id}/windows-service/{serviceName}/control
{"action": "RESTART"}          // also START / STOP.  Returns 204 (empty body) on success.
```

Real use: an endpoint agent whose command socket had gone stale was recovered by restarting its service through this endpoint, with scripting entirely unavailable. Also fine without user context: device/org/software/AV queries, `reboot`, maintenance windows, custom-field writes.

## NOTES

- **Distinguish the two failures by the status code, not the symptom.** 400 = inline content rejected, retry with a saved `scriptId`. 403 with "does not have user context" = re-issuing the key is the only fix; stop retrying.
- Check which grant your key uses before planning any remediation that depends on scripting. If the integration was created as "API Services" / client_credentials, assume no scripting.
- Saved-script discovery (when you do have user context): `GET /device/{id}/scripting/options`, then match `scripts[]` by name for the integer `id`. There is still no global script list/create API — `GET /scripting/scripts` and `POST /scripting/scripts` both 404.
- Related: [OAuth Authorization Code flow requirements](oauth-authorization-code-flow.md) — that entry documents the flow you need to mint a user-context token.
