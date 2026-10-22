---
tech: doppler
tags: [railway, sync, integrations, secrets, incident]
severity: high
---
# Doppler silently disables a Railway sync when Railway rejects its token, so prd writes stop deploying

## PROBLEM
When Railway revokes or rejects the token behind a Doppler Railway integration, "Doppler Bot" disables the integration and every sync on it, with no alert, so a write to the synced config no longer reaches any service.
Teams used to "a Doppler write redeploys production" keep writing secrets and assume they are live. The CLI shows nothing about downstream syncs, and running services keep their old values. Re-enabling the syncs later pushes the entire config at once, redeploying every synced service.

## WRONG
```bash
doppler secrets set NEW_SECRET=... --project app --config prd
# assumed: synced to Railway and redeployed within a minute
```

## RIGHT
```bash
# Check sync state before relying on it (names only, no values)
curl -s -u "$(doppler configure get token --plain):" https://api.doppler.com/v3/integrations \
  | jq '.integrations[] | {name, enabled, syncs: [.syncs[]? | {project, config, enabled}]}'
# The activity log (GET /v3/logs) shows "Doppler Bot" disabling it.
# Fix: re-authenticate the integration with a new Railway token, then re-enable the syncs.
```

## NOTES
During an incident this can be useful: with the sync off, you can stage rotated values in the config and make re-enabling the sync the single cutover redeploy. Re-check that the syncs are still disabled before each staged write.
