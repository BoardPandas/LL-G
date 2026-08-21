---
tech: railway
tags: [railway, mcp, checkSuites, wait-for-ci, service-config, silent-failure, api, verification]
severity: high
---
# Service source writes report "applied" and silently do not persist (checkSuites / Wait for CI)

## PROBLEM

Railway's "Wait for CI" setting -- the `checkSuites` flag on a service's GitHub source
connection, which holds a deploy until the check suite on that commit passes -- cannot
be set through the API, but **the write reports success anyway**.

Two paths, both dead ends, only one of them honest:

1. The Railway MCP's `update-service` tool does not expose `checkSuites` at all. Its
   description says outright that source changes are not handled. This one is fine: it
   fails visibly by having no parameter.
2. The Railway **agent**'s `updateServiceTool` *does* accept `{source: {checkSuites: true}}`
   and returns `{"status":"applied","message":"Service has been updated and changes are
   staged for deployment."}`. The value never lands. A fresh `get-service-config` still
   returns `"checkSuites": false` -- immediately after the write, and again after calling
   `commitStagedChanges` (which does fire a real deploy, so it is not that the commit
   step was skipped).

The compounding trap is in the read-back. The agent-side `getServiceConfigTool` returns a
`source` block that **omits the `checkSuites` key entirely**, which invites the inference
"the API only returns fields that are explicitly set, so the absence means it took."

That inference is backwards. The field *is* returned when set: the pre-change read through
the MCP's own `get-service-config` showed `"checkSuites": false` explicitly. The two tools
return different projections of the same object, so a key missing from one view is not
evidence of anything.

Why this bites hard: `checkSuites` is a deploy gate. Believing it is on means believing a
red CI build can no longer ship, when in fact every push still deploys immediately. The
failure is invisible until a broken build reaches production.

## WRONG

```jsonc
// Write through the Railway agent, then trust the return value.
updateServiceTool({ serviceId, config: { source: { checkSuites: true } } })
// -> {"status":"applied","message":"Service has been updated and changes are staged..."}

// Read back through the SAME agent-side tool:
getServiceConfigTool({ serviceId })
// -> "source": { "repo": "org/repo", "branch": "main" }
//                ^ no checkSuites key

// The inference that sinks you:
//   "Railway only returns fields that are explicitly set, so this is applied."
// Conclusion recorded: Wait for CI is ON.
// Reality: still false. Every push deploys, red build or not.
```

## RIGHT

```jsonc
// 1. Capture the value BEFORE the write, with the read tool you will verify with.
get-service-config({ projectId, serviceId, environmentId })
// -> "source": { "repo": "org/repo", "branch": "main", "checkSuites": false }
//     ^ the field IS returned when set -- this is your baseline and your proof
//       that "key absent" in some other view means "different projection",
//       not "successfully set".

// 2. Attempt the write.
updateServiceTool({ serviceId, config: { source: { checkSuites: true } } })
// -> "applied"   <-- treat as a claim, not a result

// 3. Re-read with the SAME tool as step 1 and quote the field.
get-service-config({ projectId, serviceId, environmentId })
// -> "checkSuites": false   <-- the write did not persist. Do not report success.
```

```
# Workaround: this setting is dashboard-only.
Railway dashboard
  -> Service
  -> Settings
  -> Source
  -> GitHub connection
  -> "Wait for CI"      (toggle per service; set it on every service that deploys from the repo)
```

## NOTES

**The general rule, which is the transferable part:** for any config write through an MCP
or agent tool, confirm by re-reading the resource with a separate read call and quoting the
field's value back. Never by the write call's return status. `"status": "applied"` is the
tool telling you it dispatched a request, not the platform telling you state changed.
Prefer the same read tool before and after, so you are comparing like with like -- two
tools over one resource can return different projections, and a key present in one and
absent in the other proves nothing on its own.

**Verified 2026-08-21** against Railway MCP + Railway agent, three independent reads, on
two services (Web and Worker) in one project. Other writes through the plain MCP
`update-service` tool (`healthcheckPath`, `healthcheckTimeout`) persisted correctly and
appeared in the same reads, so this is specific to the `source` block, not a broken
connection or a stale-read artifact.

**Adjacent:** an HTTP healthcheck path only belongs on services that actually serve HTTP.
Setting one on a queue-worker service (BullMQ, Sidekiq, a bare consumer) with no listening
port fails every deploy rather than protecting it. Where worker and web share
`DATABASE_URL` / `REDIS_URL`, the web probe already covers the same dependencies.

**Related:** `kb/mcp/llms.txt` for MCP server/host integration gotchas; the same
verify-by-re-reading discipline appears in `kb/claude-code/` for hooks that fail open
while looking healthy.
