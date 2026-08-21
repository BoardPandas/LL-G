---
tech: railway
tags: [api, update-service, mcp, config-write, partial-write, silent-failure, predeploy, restart-policy]
severity: high
---
# `update-service` returns `updatedFields` echoing the REQUEST, so a partly-ignored write reads as a full success

## PROBLEM

Railway's service-update API (and the MCP tool wrapping it) answers with an
`updatedFields` array. That array is an echo of what you **asked** for, not a
report of what it **wrote**. Send three fields, have one silently dropped, and
you still get all three back with no error and no warning.

This is worse than the total-failure case in
`service-source-write-reports-applied.md`, because partial success defeats the
obvious defence. Spot-check one field, see it landed, and you conclude the call
worked — while a sibling field in the same request never persisted.

Observed live: one call set `preDeployCommand`, `restartPolicyType` and
`restartPolicyMaxRetries` on a web service. The response listed all three.
`preDeployCommand` and `restartPolicyMaxRetries` landed. `restartPolicyType` did
not, and the read-back **omitted the key entirely** rather than showing a wrong
value — so absence again invites the backwards inference that it defaulted fine.

`preDeployCommand` makes this expensive: it is where deploy-time database
migrations run. A write that reports success and does not persist means
migrations stop running before promotion, and the first symptom is application
code querying columns that do not exist.

## WRONG

```jsonc
// Request
{ "preDeployCommand": ["node scripts/migrate-deploy.mjs"],
  "restartPolicyType": "ON_FAILURE",
  "restartPolicyMaxRetries": 3 }

// Response — all three echoed back. Two were written.
{ "updatedFields": ["preDeployCommand", "restartPolicyType", "restartPolicyMaxRetries"] }
```

```bash
# The trap: spot-checking ONE field and generalising.
get-service-config | jq '.config.deploy.preDeployCommand'
# ["node scripts/migrate-deploy.mjs"]   -> "the write worked"   WRONG
```

## RIGHT

```bash
# Re-read and assert EVERY field you sent, by name. Treat a MISSING key as
# not-written, never as "defaulted correctly".
get-service-config | jq '.config.deploy | {preDeployCommand, restartPolicyType, restartPolicyMaxRetries}'
# {
#   "preDeployCommand": ["node scripts/migrate-deploy.mjs"],
#   "restartPolicyType": null,          <-- never landed
#   "restartPolicyMaxRetries": 3
# }
```

An independent second reader is stronger still, because it reports the
*effective* value rather than the stored one:

```bash
railway config plan          # read-only
# ~ Update web deploy.restartPolicyType
#     restartPolicyType (null -> "ON_FAILURE")     <-- still unset, confirmed
```

## NOTES

- Before chasing a non-persisting field, check whether it even matters. Here
  `restartPolicyType: null` is harmless: Railway's documented default already is
  `ON_FAILURE`. `restartPolicyMaxRetries` DID need setting, because the default
  is 10, not 3. Establish the platform default before treating an unset field as
  a bug — and prefer leaving a field unset when it matches the default, or
  `railway config plan` shows a pending change forever and stops being read.
- `deploy.*` fields are writable through this tool; `source.*` fields are not
  (see `service-source-write-reports-applied.md`). The tool documents that it
  "does not handle source changes", and honours that by discarding them silently
  rather than erroring.
- `preDeployCommand` and the restart policy also come from `railway.toml` if the
  repo has one, and Config as Code **overrides** the service setting. So a
  service-level value can be correct and still not be what runs. Railway stops
  reading Config as Code on **2026-12-01** (hard cutoff), at which point the
  service setting silently becomes authoritative — set both to the same value
  during any migration, and verify with a real deploy log line, not a read-back:

  ```
  [migrate-deploy] migrations applied and verified -- proceeding with deploy.
  ```
