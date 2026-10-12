---
tech: mcp
tags: [mcp, agents, createMcpHandler, cors, origin, preflight, cloudflare-workers]
severity: medium
---
# agents' `createMcpHandler` allows CORS from every origin by default

## PROBLEM
With no options, `createMcpHandler` from `agents/mcp/server` (0.28.0) adds `Access-Control-Allow-Origin: *` and `Access-Control-Expose-Headers: mcp-session-id` to every reply and answers `OPTIONS` preflights itself. Its Origin allowlist defaults to the localhost origins, plus the request's own hostname on `*.workers.dev`, plus `corsOptions.origin`'s hostname if set. For a server that only agents (CLIs, IDEs) call and no browser ever should, both defaults are surface nobody asked for, and neither shows up unless a test looks at headers.

## WRONG
```ts
const handler = createMcpHandler(factory, { allowedHostnames: [apiHost] });
// every reply: Access-Control-Allow-Origin: *; OPTIONS /mcp answered with CORS headers
```

## RIGHT
```ts
const handler = createMcpHandler(factory, {
  allowedHostnames: [apiHost],
  allowedOriginHostnames: [], // any Origin header -> 403; no Origin (agents) -> allowed
  corsOptions: false,         // strips every access-control-* header, no OPTIONS short-circuit
});
```

## NOTES
- Test: a request with `Origin: https://evil.example` is 403, the same request without `Origin` is served, and no reply carries an `access-control-*` header.
- `allowedOriginHostnames: "*"` disables the Origin check entirely; it is not the same as `[]`.
- Related: `allowed-hostnames-checks-host-header.md`.
- Verified 2026-10-12.
