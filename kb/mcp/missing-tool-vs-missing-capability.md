---
tech: mcp
tags: [mcp, tool-discovery, claude-code, api-key, workaround, diagnosis, auth]
severity: high
---
# A missing MCP tool is not a missing capability

## PROBLEM

An MCP tool absent from the host's tool manifest reads as "this capability is
unavailable". It almost never is. In a typical deployment each MCP tool is a
thin wrapper (often <10 lines) over an HTTP route that the server also exposes
to other authentication methods -- session cookie, `X-API-Key`, bearer token.
The wrapper going missing says nothing about the route.

The failure mode is not the missing tool. It is that every dead end offers a
*plausible workaround* -- run it from the web UI, restart the client, use a
different tool, hand it to the user -- and each workaround restores forward
motion, which suppresses the question "is my framing wrong?". You are never
stuck enough to re-diagnose. The cost lands on the user, who experiences the
same blocker across many sessions while each individual session appears to make
progress.

Observed: six client sessions were spent working around an "unavailable"
`simulate_gauntlet` MCP tool. The tool was defined, exported, registered, and
deployed; it was simply absent from that host's manifest. Its entire body was a
call to `POST /api/sim/gauntlet` -- a route whose auth middleware accepted
`X-API-Key`, mounted globally, with API-key clients explicitly exempted from
CSRF. A valid key was already provisioned in the secrets manager. The header
comment of the very file inspected during diagnosis read: *"those routes
authenticate via cookie session or X-API-Key"*. It was read past, because the
question being asked was the narrow "can I forge the internal bridge secret?"
rather than the general "how does this API authenticate?".

Compounding trap: do NOT attempt to use the server's internal loopback/bridge
secret as the workaround. A well-built bridge mints it with `randomBytes()` at
boot and never puts it in the environment, specifically so it cannot be forged
from outside the process. That path is closed by design; the API key is the
supported one.

## WRONG

```
# Tool absent from the manifest -> declare the capability unavailable,
# then burn sessions on workarounds that each "work" just enough.
ToolSearch "select:simulate_gauntlet"   -> no match
ToolSearch "gauntlet"                   -> no match
=> "You'll have to run it from the browser."
=> "Try a fresh session, the manifest will rebuild."   (it did not)
=> "I could run a different measurement instead."      (not what was asked)
=> user re-asks across 6 sessions; each session reports partial progress
```

## RIGHT

```
# Two failed attempts at the SAME capability = stop and enumerate the
# access surface BEFORE accepting any workaround.

# 1. What does the tool actually wrap? (read its handler)
grep -rn 'name: "simulate_gauntlet"' -A 30 src/lib/mcp/
#   -> loopback("POST", "/api/sim/gauntlet", user, {...})   # it is just a route

# 2. What auth does that route accept? (read the middleware chain, not one file)
grep -rn "x-api-key\|apiKeyAuth\|resolveApiKey" src/middleware/ src/server.ts
#   -> app.use("*", resolveApiKeyFallback)     # global: covers every route
#   -> csrf.ts: if (c.get("apiKeyId")) return next()   # key clients CSRF-exempt

# 3. Is a credential already provisioned?
doppler secrets names --project <proj> --config prd | grep -i key
#   -> DASHBOARD_API_KEY   # provisioned the whole time

# 4. Prove it end-to-end before building anything on top.
curl -sS -o /dev/null -w '%{http_code}' \
  -H "x-api-key: $KEY" https://host/api/proxy/decks     # -> 200

# Then wrap it once, in the repo, so the next session inherits the escape hatch
# instead of rediscovering it.
```

## NOTES

- **Tripwire, stated as a rule:** two failed attempts at the same capability =
  stop, enumerate every transport (MCP tool / HTTP route + each auth method /
  CLI / UI / direct DB) in parallel, and name *why* the primary path failed
  before proposing a secondary one. A workaround accepted without that naming is
  how a one-hour problem becomes a six-session problem.
- **Parallelize the framing, not just the execution.** The natural instinct is
  to fan out agents on work already scoped. The higher-value fan-out here is
  competing hypotheses, each required to return evidence: (a) client-side, prove
  it from the manifest; (b) server-side, prove it from the deployed artifact;
  (c) the capability has another door -- enumerate all transports. Hypothesis
  (c) resolves this class of problem in minutes.
- **A route answering with its OWN error is proof of deployment.** `{"error":
  "Deck not found"}` from an ACL check means the route exists and ran; a generic
  `{"code":"NOT_FOUND"}` from the router means it does not. Use that to separate
  "not deployed" from "not authorized" without any credential.
- Restarting the client is worth exactly one attempt. If the same tools are
  missing twice, the manifest is not the variable and further restarts are pure
  cost -- the user is the one paying it.
- Related: [Process-global MCP server leaks across tenants](process-global-server-cross-tenant-leak.md).
