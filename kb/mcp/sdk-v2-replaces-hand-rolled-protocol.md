---
tech: mcp
tags: [mcp, sdk, typescript, streamable-http, hono, multi-tenancy, 2026-07-28]
severity: medium
---
# The MCP TypeScript SDK v2 is separate packages -- @modelcontextprotocol/sdk is the v1 line

## PROBLEM

Checking whether an official server SDK exists by running `npm view @modelcontextprotocol/sdk`
returns `1.30.0` — the **v1** line, a monolithic package built around Node's `IncomingMessage` /
`ServerResponse`. On a fetch-based stack (Hono, Cloudflare Workers, Deno, Bun) that looks like it
needs bridging, which is a plausible reason to hand-roll the protocol instead.

**v2 is a different set of packages**, and `@modelcontextprotocol/sdk` is not among them:

| Package | Role |
|---|---|
| `@modelcontextprotocol/server` | The server SDK, implementing 2026-07-28 |
| `@modelcontextprotocol/client` | The client SDK |
| `@modelcontextprotocol/core` | Shared types |
| `@modelcontextprotocol/hono` · `/express` · `/fastify` · `/node` | Thin framework adapters |

Hand-rolling the transport instead means owning era classification, the per-request `_meta`
envelope, header/body agreement, `resultType`, notification handling and the legacy fallback —
every one of which is a documented MUST that fails silently against some client and not others.

Two specific things the v2 server package provides that are easy to assume are absent:

- **`WebStandardStreamableHTTPServerTransport`** takes a `Request` and returns a `Response`. There
  is no Node `req`/`res` bridging to do.
- **`createMcpHandler(factory, opts)`** calls its factory **once per request**, so each request gets
  a fresh `McpServer`. That is what makes a per-caller `tools/list` possible at all (a client and an
  admin must see different tools), and it removes the process-global-state tenant leak by
  construction.

## WRONG

```ts
// "npm view @modelcontextprotocol/sdk" showed 1.30.0, built on Node req/res,
// so the protocol was implemented by hand: JSON-RPC dispatch, era gating,
// header/body validation, result envelope, legacy fallback. ~400 lines.
export async function handleMcpMessage(raw: unknown, ctx: McpRequestContext) {
  const modern = ctx.headers.get('mcp-protocol-version') !== null;  // wrong gate
  ...
  default:
    return { status: 404, body: errorBody(id, { code: -32601, ... }) };  // kills old clients
}
```

## RIGHT

```ts
import { createMcpHandler, McpServer, fromJsonSchema } from '@modelcontextprotocol/server';

// One fresh server per request: per-caller tool lists, and no state shared between callers.
const handler = createMcpHandler(
  (context) => {
    const server = new McpServer({ name: 'portal', version }, { instructions });
    // `authInfo` is strictly pass-through -- the SDK verifies no tokens and reads no
    // headers for identity. Whatever the route resolved comes back here unchanged.
    const principal = context.authInfo?.extra?.principal;
    for (const tool of toolsFor(principal)) {
      server.registerTool(tool.name, {
        description: tool.description,
        // Existing JSON Schema is reusable as-is; no Zod rewrite needed.
        inputSchema: fromJsonSchema(tool.inputSchema),
      }, handlerFor(tool));
    }
    return server;
  },
  { legacy: 'stateless' },   // serves 2025-era clients too; GET/DELETE answer 405
);

// Hono, or any fetch-based runtime:
app.post('/mcp', (c) => handler.fetch(c.req.raw, { authInfo }));
```

## NOTES

- `authInfo` being pass-through matters: identity stays established in exactly one place in your
  app. The SDK never second-guesses it.
- `legacy: 'stateless'` answers 2025-era traffic with a fresh instance per request and returns
  `405` for its session operations. `legacy: 'reject'` is modern-only.
- Register `/mcp` methods explicitly (`app.post` / `app.get` / `app.delete`) rather than
  `app.all` if a route-table test inspects registrations — an `ALL` registration can read as
  middleware and silently empty that assertion.
- Migrating away from a hand-rolled layer deletes most of its tests too: era gates, envelope shape
  and 404-vs-200 become the dependency's behaviour. What is still worth testing is what is yours —
  which tools a caller is offered, and how a refused HTTP response maps to `isError`.
- Related: `protocol-version-header-predates-its-rules.md` and
  `unknown-method-404-kills-legacy-clients.md` are both bugs that a hand-rolled layer invites and
  the SDK forecloses.
