---
tech: mcp
tags: [mcp, sdk, createMcpHandler, agents, legacy, 2025-06-18, 2025-11-25, sse, json, cloudflare-access]
severity: medium
---
# agents' `createMcpHandler` answers 2025-era clients with SSE, and no option changes that

## PROBLEM
`createMcpHandler` from `agents/mcp/server` (0.28.0, over `@modelcontextprotocol/server` 2.0.0) serves 2025-era clients (2025-03-26, 2025-06-18, 2025-11-25) on its default `legacy: "stateless"` lane, and every reply there is `text/event-stream` carrying one `message` event, even for a plain request/response. `responseMode` applies only to the 2026-07-28 lane. Passing the v1 option `enableJsonResponse` throws `TypeError` ("only supported with an MCP SDK v1 server"), and the SDK's own `legacyStatelessFallback` is SSE-only as well. So a server that promises JSON replies, or sits behind a proxy that buffers or rewrites SSE (Cloudflare Access, corporate proxies), gets SSE from every older client.

## WRONG
```ts
import { createMcpHandler } from "agents/mcp/server";

const handler = createMcpHandler(factory, {
  responseMode: "json",     // modern lane only
  enableJsonResponse: true, // TypeError with a v2 server
});
```

## RIGHT
```ts
// Either accept SSE on the legacy lane (test that it survives your proxy, and parse the
// `message` event in tests), or compose the JSON route yourself:
import { createMcpHandler } from "agents/mcp/server";
import { isLegacyRequest, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";

const modern = createMcpHandler(factory, { legacy: "reject" });

async function serve(request: Request, parsedBody: unknown, authInfo: AuthInfo): Promise<Response> {
  if (!(await isLegacyRequest(request, parsedBody))) return modern.fetch(request, { authInfo, parsedBody });
  // From here YOU own Host/Origin validation, 405 for GET/DELETE, and teardown on this lane.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  const server = buildServer(authInfo);
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, { authInfo, parsedBody });
  } finally {
    await server.close();
  }
}
```

## NOTES
- `isLegacyRequest` is async; route its `false` answers to the modern handler, which owns the header/envelope error replies.
- Composition re-implements what the wrapper did for you (Host and Origin checks, CORS, OPTIONS, method handling), so test those on the legacy lane separately.
- Related: `subscriptions-listen-holds-sse-stream.md` (the modern lane's own SSE case).
- Verified in workerd under `@cloudflare/vitest-plugin` 1.4.0, 2026-10-12.
