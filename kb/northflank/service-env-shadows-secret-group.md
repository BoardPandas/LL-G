---
tech: northflank
tags: [secrets, env-vars, secret-groups, doppler, deployment, api, credential-rotation]
severity: high
---
# Service-level runtime env silently shadows secret-group values

## PROBLEM
A Northflank service's effective environment is the inherited secret group MERGED WITH the service's own runtime environment, and the service-level value wins. Nothing in the UI or API flags the conflict. So when a key is defined in BOTH places, editing or deleting it in the shared secret group looks like it worked -- the group genuinely no longer has the key -- while the running container keeps serving the stale service-level value indefinitely, across restarts and redeploys.

This is especially likely for a key that was once hotfixed directly onto a service and later added to the group: both copies persist, and the group copy is dead weight nobody notices until someone tries to change it. The worst version is a provider API key pinned on every service: rotating it in the group (or upstream in Doppler) appears to succeed and takes effect nowhere.

Two endpoints with nearly the same name return different things, and getting them backwards is the main diagnostic trap:

- `GET /v1/projects/{p}/services/{s}` -> `.runtimeEnvironment` is the service's **own pins ONLY**. Authoritative override list. Usually tiny or `{}`.
- `GET /v1/projects/{p}/services/{s}/runtime-environment` -> the **merged effective env** (group + pins + addon-injected `NF_*`). Large.

Both are trustworthy; they answer different questions. Use the first to audit overrides, the second to see what the container actually gets. Treating the merged endpoint as the only truth throws away the one call that directly answers "what is this service overriding?", and can lead to the catastrophic misreading that a service overrides nearly every key -- and a "fix" that blanks the runtime env of every service.

## WRONG
```bash
# Goal: stop overriding GEMINI_MODEL so the application's own default applies.
# Clear it from the shared secret group every service inherits, confirm it's gone:
curl ".../v1/projects/$P/secrets/doppler-env" | jq '.data.secrets.variables.GEMINI_MODEL'
# -> null.  Looks done. Restart. Container STILL serves the old model.

# Then trying to find what else is pinned, by subtracting the group from the
# merged effective env:
comm -13 <(jq -r '.data.secrets.variables|keys[]' group.json | sort) \
         <(jq -r '.data.runtimeEnvironment|keys[]'  rte.json  | sort)
# -> only reveals pins whose NAME is absent from the group.
#    A pin that shadows a group key with a DIFFERENT VALUE shares the key name,
#    so it never shows up here -- the credential-rotation trap is invisible to
#    exactly this check.
```

## RIGHT
```bash
# 1. Read the service's ACTUAL pins from the service object. This is the
#    authoritative override list, and it is the only call that finds a pin
#    shadowing a same-named group key.
curl -sS ".../v1/projects/$P/services/$S" | jq '.data.runtimeEnvironment'
# -> {"MIGRATION_DATABASE_URL":"..."}   or {}  -- compare BY VALUE against the group

# 2. Classify each pin whose name also exists in the group:
#      same value      -> redundant; harmless now, will swallow the next rotation
#      different value -> actively shadowing; syncing that key is a no-op here

# 3. Fix the layer that wins. NOTE THE VERB: PATCH returns 405 here.
#    POST replaces the whole map, so send every pin you intend to KEEP.
#    Omit NF_<addon>_* vars -- the addon link re-injects them.
curl -X POST ".../v1/projects/$P/services/$S/runtime-environment" \
  --data '{"runtimeEnvironment":{"MIGRATION_DATABASE_URL":"..."}}'
# -> {"success":true,"restartSuccessful":true}   (it restarts the service for you)

# 4. Re-read /services/{id}/runtime-environment (the MERGED view) and assert the
#    value the container will now see, before believing it.
```

## NOTES
Rule of thumb: one key, one layer. Keep everything in the secret group and keep service-level env empty except genuinely per-service values -- e.g. a migration DSN pointing at the public DB host while the group's `DATABASE_URL` is the internal addon host.

Worth automating in any sync/audit script: compare group keys against every service's pins and flag the two cases separately -- redundant pin (warn) versus conflicting pin (fail CI). A name-only diff is not sufficient; compare values.

`NF_*` variables (e.g. `NF_REDIS_REDIS_MASTER_URL`) are injected by an addon link, not pins. They do not appear in the service object's `runtimeEnvironment` and reappear on their own if deleted -- exclude them from any override audit.

Verb summary: on `/services/{id}/runtime-environment`, `PATCH` -> 405, `POST` -> 200. On `/secrets/{id}`, `PATCH` works. Both are replace-not-merge, so always GET, modify the full map, send it back complete.

Secret-group edits are not hot-reloaded; the container serves the old value until it restarts. So a secret actually reaching a running process requires all three: it reached the group, it is not shadowed by a pin, and the service restarted.

See also `doppler-no-auto-sync-env-full-replace.md` in this folder: Doppler does not auto-sync into Northflank, and runtime env updates are a full replace. This entry is the third compounding trap in the same family. Read both before touching Northflank secrets.
