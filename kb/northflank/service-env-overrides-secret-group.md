---
tech: northflank
tags: [secrets, secret-groups, env-vars, runtime-environment, api, credential-rotation]
severity: high
---
# Service-level runtime env silently overrides the secret group, and the two "runtime environment" endpoints mean different things

## PROBLEM
A service's effective environment is the inherited secret group merged with the service's OWN runtime environment, and the service-level value wins. Nothing surfaces the conflict -- not the dashboard, not the API. A key pinned on the service is invisibly authoritative.

The consequence is a silent credential-rotation trap: rotate a pinned key in Doppler, sync it to the secret group, restart the service, and the service keeps using the old pinned value. Every step reports success. There is no error anywhere.

Diagnosing it has its own trap, because two endpoints have nearly the same name and mean opposite things:

- `GET /v1/projects/{p}/services/{id}` -> `.runtimeEnvironment` returns **only the service's own pins**. This is the authoritative override list, and it is usually tiny or empty.
- `GET /v1/projects/{p}/services/{id}/runtime-environment` returns the **merged effective env** (group + pins + addon-injected vars). This is large.

Mistaking the second for the first makes every ordinary group key look like a service-level override. That misreading points at a catastrophic "fix": blanking the runtime environment of every service to eliminate overrides that were never there.

## WRONG
```bash
# "Which keys does this service override?" -- diffing the MERGED env against the group.
curl -H "Authorization: Bearer $TOKEN" \
  ".../projects/$P/services/$SVC/runtime-environment"   # 96 keys: group + pins + addon vars
# minus the 95-key group => looks like the service overrides almost nothing,
# or (if the group drifted) like it overrides dozens of keys. Both readings are wrong.

# Then, having "found overrides", trying to clear them:
curl -X PATCH ... ".../services/$SVC/runtime-environment" \
  -d '{"runtimeEnvironment":{}}'
# -> 405 Method Not Allowed. The verb is POST, not PATCH.
```

## RIGHT
```bash
# 1. Read the service's ACTUAL pins from the service object, not the merged endpoint.
curl -sS -H "Authorization: Bearer $TOKEN" ".../projects/$P/services/$SVC" \
  | jq '.data.runtimeEnvironment'          # {} or a handful of keys -- the real override list

# 2. Any pin whose name also exists in the group is shadowing it. If the values
#    differ, syncing that key to the group is a no-op for this service.

# 3. To clear pins: POST (not PATCH), and it REPLACES the whole map, so write back
#    exactly what you intend to keep.
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  ".../projects/$P/services/$SVC/runtime-environment" \
  -d '{"runtimeEnvironment":{"MIGRATION_DATABASE_URL":"'"$KEEP"'"}}'
# -> {"data":{"success":true,"restartSuccessful":true}}  (it restarts the service for you)
```

## NOTES
Aim for one source per key: the group owns everything, and a service pins a variable only when it genuinely must differ (e.g. a migration DSN pointing at the public DB host while the group's DATABASE_URL is the internal addon host).

`NF_*` variables (e.g. `NF_REDIS_REDIS_MASTER_URL`) are injected by an addon link, not pins. They do not appear in the service object's `runtimeEnvironment`, and they reappear on their own if deleted -- exclude them from any override audit.

Worth automating: a sync/audit script should compare group keys against every service's pins and flag two cases separately -- a pin duplicating the group value (harmless today, but it will swallow the next rotation) versus a pin holding a different value (actively discarding synced values; fail CI on this one).

Related: [doppler-no-auto-sync-env-full-replace.md](doppler-no-auto-sync-env-full-replace.md) covers the companion traps -- Doppler configs never auto-sync to Northflank in the first place, and the secret-group write is likewise a full replace. Both must be true at once for a secret to actually reach a running process: it has to reach the group, AND not be shadowed by a pin, AND the service has to restart.
