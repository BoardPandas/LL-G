---
tech: mcp
tags: [mcp, tool-discovery, tools-list, claude-code, api-key, workaround, diagnosis, auth]
severity: high
---
# A missing MCP tool is not a missing capability

## PROBLEM

An MCP tool absent from the client's tool list reads as "this capability is
unavailable". It almost never is. In a typical deployment each MCP tool is a
thin wrapper (often <10 lines) over an HTTP route the server ALSO exposes to
other auth methods -- session cookie, `X-API-Key`, bearer token. The wrapper
being missing says nothing about the route.

There are two independent failures here, and conflating them costs days.

**Failure 1 -- the tool is defined but never ADVERTISED.** A registry commonly
has two lists: the tools that exist in code, and the list the server actually
returns from `tools/list`. If the second is assembled by naming tools one at a
time, a new tool can be fully written, exported, imported, and deployed while
never being named -- so no client can see or call it, and NOTHING errors. Code
inspection "proves" the tool is registered and is misleading, because you are
reading the wrong list. Observed: `simulate_gauntlet` / `gauntlet_status` were
written and working for 30 releases while absent from every client's tool list.

**Failure 2 -- each dead end offers a plausible workaround.** Run it from the
web UI, restart the client, use a different tool, hand it to the user. Every one
restores forward motion, which suppresses the question "is my framing wrong?".
You are never stuck enough to re-diagnose. The cost lands on the USER, who hits
the same blocker across many sessions while each session looks locally
productive. Six sessions were burned this way before anyone asked for a root
cause. The backing route accepted `X-API-Key` the entire time, and a valid key
was already provisioned in the secrets manager.

Compounding trap: do NOT try to use the server's internal loopback/bridge secret
as the workaround. A well-built bridge mints it with `randomBytes()` at boot and
never puts it in the environment, precisely so it cannot be forged from outside
the process. That door is closed by design; the API key is the supported one.

## WRONG

```
# Tool absent -> declare the capability unavailable, then burn sessions on
# workarounds that each "work" just enough to prevent the real diagnosis.
ToolSearch "gauntlet"  -> no match
=> "Run it from the browser."
=> "Try a fresh session, the manifest will rebuild."      (it did not)
=> "I'll run a different measurement instead."            (not what was asked)

# And the seductive half-diagnosis: grep the source, find the tool defined and
# spread into an exported array, conclude "server is fine, it's the client."
grep -n 'name: "simulate_gauntlet"' src/lib/mcp/tools-*.ts   # present!
# ^ This proves the tool EXISTS. It does not prove it is ADVERTISED.
```

## RIGHT

```
# 1. Ask what the tool wraps. It is usually just a route.
grep -rn 'name: "simulate_gauntlet"' -A 30 src/lib/mcp/
#   -> loopback("POST", "/api/sim/gauntlet", user, {...})

# 2. Compare the two lists: tools DEFINED vs tools ADVERTISED.
#    Find whatever builds the tools/list response and check membership there --
#    an allow-list, a name array, a per-tool registration call.
grep -rn "tools/list\|listTools\|registerTool\|ALL_TOOLS" src/lib/mcp/
#    Ground truth is the wire: read the server's actual tools/list response
#    with a valid token, not the source.

# 3. Independently, enumerate the OTHER transports for the same capability.
grep -rn "x-api-key\|resolveApiKey" src/middleware/ src/server.ts
#   -> app.use("*", resolveApiKeyFallback)          # global: every route
#   -> csrf.ts: if (c.get("apiKeyId")) return next() # key clients CSRF-exempt

# 4. Prove it end-to-end before building on it.
curl -sS -o /dev/null -w '%{http_code}' -H "x-api-key: $KEY" https://host/api/... # 200

# 5. Wrap it once, in the repo, so the next session inherits the escape hatch.
```

## NOTES

- **Tripwire:** two failed attempts at the same capability = stop. Enumerate
  every transport (MCP tool / HTTP route + each auth method / CLI / UI / direct
  DB) and name WHY the primary path failed before proposing a secondary one. An
  unexplained workaround is the tell that diagnosis was skipped.
- **"Defined" != "advertised".** Reading the source and finding the tool present
  is a false negative for this bug. The authoritative check is the server's
  `tools/list` response on the wire, or the specific code that builds it.
- **Parallelize the framing, not just the execution.** Fan out competing
  hypotheses that must each return evidence -- (a) client-side, prove from the
  manifest; (b) server-side, prove from the deployed artifact AND the advertised
  list; (c) the capability has another door, enumerate all transports. (b) and
  (c) are the ones a "the tool is missing" framing never suggests.
- **A route answering with its OWN error proves deployment.** `{"error":"Deck not
  found"}` from an ACL check means the route exists and ran; a generic
  `{"code":"NOT_FOUND"}` from the router means it is not mounted. That separates
  "not deployed" from "not authorized" with no credential at all.
- Restarting the client is worth exactly ONE attempt. Same tools missing twice
  means the client is not the variable -- and further restarts bill the user.
- Related: [Process-global MCP server leaks across tenants](process-global-server-cross-tenant-leak.md).
