---
tech: mcp
tags: [mcp, multi-tenant, tenant-isolation, stdio, singleton, oauth, process-env, security]
severity: high
---
# Process-global MCP server leaks across tenants if run in-process

## PROBLEM
Many stdio MCP servers are built as a single-tenant process: a module-global client is
constructed from `process.env` at import time, and every tool handler reads that one global.
Intuit's `quickbooks-online-mcp-server` is typical -- it ends with
`export const quickbooksClient = new QuickbooksClient({ clientId: process.env.QUICKBOOKS_CLIENT_ID, ... })`
and all ~140 handlers call the static `QuickbooksClient.getInstance()`.

If you host such a server in a multi-tenant bridge by building one `McpServer` per session but
running them all in the SAME node process (the natural "in-process" pattern), every session's
tools hit that same global client -- bound to whichever tenant's credentials happened to load at
container boot. User B silently reads User A's data. This is a cross-tenant data leak, not a crash,
so it passes every smoke test that only exercises one tenant.

Two related on-disk footguns make it worse: a `dotenv.config({ override: true })` that reads a
`.env` from the shared package dir will override the per-tenant env you inject, and any code that
persists a rotated refresh token back to that `.env` writes one tenant's secret where the next
tenant's process reads it. Interactive browser-OAuth fallbacks (bind a port, launch a browser)
also hang forever in a headless container and collide across sessions.

## WRONG
```ts
// One shared process. Each session builds a server, but all handlers reach the
// same process-global client bound to boot-time env -> cross-tenant leak.
function makeSession(creds) {
  process.env.QUICKBOOKS_REFRESH_TOKEN = creds.refreshToken; // races other sessions
  const server = new McpServer(...);
  registerAllTools(server); // handlers call QuickbooksClient.getInstance() (global)
  return server;
}
```

## RIGHT
```ts
// Spawn ONE child process per session. The global singleton is safe because each
// child sees exactly one tenant's creds via injected env. (One child = one tenant.)
stdioSpec: (creds) => ({
  command: process.execPath,
  args: [require.resolve("@vendor/quickbooks-mcp")], // built dist/index.js
  env: {
    QUICKBOOKS_CLIENT_ID: creds.clientId,
    QUICKBOOKS_REFRESH_TOKEN: creds.refreshToken,
    QUICKBOOKS_REALM_ID: creds.realmId,
    // ...
  },
});
// Also patch the vendored client: remove dotenv .env override, make on-disk token
// persistence a no-op, and replace the interactive OAuth fallback with a thrown error.
```

## NOTES
Detection before choosing in-process vs stdio: grep the upstream for `process.env` reads at
module scope and for static singleton getters (`static getInstance()`). If the server's state is
process-global, it MUST be spawned per session (stdio), never shared in-process. Bonus: a child
process also isolates the vendored server's dependency versions (e.g. an older MCP SDK / zod) from
the host. Ensure your container reaps children (e.g. dumb-init as PID 1). Related:
architecture data-ownership entries; typescript `fail-open-compound-tenant-guard` and
`sentinel-values-skip-authorization` (same cross-tenant failure class).
