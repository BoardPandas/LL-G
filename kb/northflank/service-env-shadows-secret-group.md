---
tech: northflank
tags: [secrets, env-vars, secret-groups, doppler, deployment, api]
severity: high
---
# Service-level runtime env silently shadows secret-group values

## PROBLEM
A Northflank service's effective environment is the inherited secret group MERGED WITH the service's own runtime environment, and the service-level value wins. Nothing in the UI or API flags the conflict. So when a key is defined in BOTH places, editing or deleting it in the shared secret group looks like it worked -- the group genuinely no longer has the key -- while the running container keeps serving the stale service-level value indefinitely, across restarts and redeploys.

This is especially likely for a key that was once hotfixed directly onto a service and later added to the group: both copies persist, and the group copy is dead weight nobody notices until someone tries to change it.

Two observability traps make the diagnosis worse:

1. `GET /v1/projects/{p}/services/{s}` has a `runtimeEnvironment` field, and `GET /v1/projects/{p}/services/{s}/runtime-environment` returns a DIFFERENT, LARGER set. Only the dedicated endpoint is the true effective env. Trusting the one on the service object -- or diffing the two against each other -- sends you down the wrong path.
2. A secret-group edit is not hot-reloaded, so even after you fix the right layer the container serves the old value until it restarts.

## WRONG
```bash
# Goal: stop overriding GEMINI_MODEL so the application's own default applies.
# Clear it from the shared secret group every service inherits:
curl -X PATCH ".../v1/projects/$P/secrets/doppler-env" \
  --data '{"secrets":{"variables":{ ...full map minus GEMINI_MODEL... }}}'

# Confirm the group no longer has it -- it doesn't. Looks done.
curl ".../v1/projects/$P/secrets/doppler-env" | jq '.data.secrets.variables.GEMINI_MODEL'
# -> null

# Restart, then read the service object's runtimeEnvironment field:
curl ".../v1/projects/$P/services/$S" | jq '.data.runtimeEnvironment.GEMINI_MODEL'
# -> "gemini-3.1-flash-lite-preview"    <-- STILL SERVED, and you now have two
#    contradictory readings with no explanation. The key was ALSO pinned at the
#    service level, which shadows the group.
```

## RIGHT
```bash
# 1. Read the TRUE effective env from the dedicated endpoint (not the service object).
curl ".../v1/projects/$P/services/$S/runtime-environment" > rte.json
jq '.data.runtimeEnvironment | keys | length' rte.json          # e.g. 96

# 2. Diff it against the group to reveal what is pinned at the service level.
#    Anything in the effective env but NOT in the group is service-level
#    (or an NF_<addon>_* auto-injection from a linked addon).
comm -13 <(jq -r '.data.secrets.variables|keys[]' group.json | sort) \
         <(jq -r '.data.runtimeEnvironment|keys[]'  rte.json | sort)
# -> GEMINI_MODEL, MIGRATION_DATABASE_URL, NF_REDIS_REDIS_MASTER_URL, ...

# 3. Fix the layer that actually wins. NOTE THE VERB: PATCH returns 405 here.
#    POST replaces the whole map, so send every service-level key you intend to
#    KEEP. Omit NF_<addon>_* vars -- the addon link re-injects them.
curl -X POST ".../v1/projects/$P/services/$S/runtime-environment" \
  --data '{"runtimeEnvironment":{"MIGRATION_DATABASE_URL":"..."}}'
# -> {"success":true,"restartSuccessful":true}   (it restarts the service for you)

# 4. Re-read the effective env and assert the key is ABSENT before believing it.
```

## NOTES
Rule of thumb: one key, one layer. Keep everything in the secret group and keep service-level env empty except genuinely per-service values, or every future rotation carries a silent shadowing failure mode. The nastiest version is a provider API key pinned at the service level on EVERY service: rotating it in the group (or upstream in Doppler) then appears to succeed and takes effect nowhere.

Verb summary: on `/services/{id}/runtime-environment`, `PATCH` -> 405 and `POST` -> 200. On `/secrets/{id}`, `PATCH` works. Both are replace-not-merge, so always GET, modify the full map, and send it back complete.

Trust only `/services/{id}/runtime-environment` for what a container actually sees. Verifying a secrets change against the group alone, or against the service object's `runtimeEnvironment`, is how a "fixed" config ships still broken.

See also `doppler-no-auto-sync-env-full-replace.md` in this folder: Doppler does not auto-sync into Northflank, and runtime env updates are a full replace. This entry is the third compounding trap in the same family -- even once the right store is synced, a service-level pin can still shadow it. Read both before touching Northflank secrets.
