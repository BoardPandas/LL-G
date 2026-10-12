---
tech: mcp
tags: [mcp, sdk, createMcpHandler, subscriptions, sse, 2026-07-28, cloudflare-workers, agents]
severity: high
---
# `subscriptions/listen` opens a long-lived SSE stream whatever `responseMode` says

## PROBLEM
On the 2026-07-28 lane, `createMcpHandler` (`@modelcontextprotocol/server` 2.0.0, and `agents/mcp/server` 0.28.0 over it) answers `subscriptions/listen` with `text/event-stream`: an acknowledgement event, then a keepalive every 15 s, for as long as the client stays connected. It does this in **every** `responseMode`, including `"json"`, and even when the server advertises `tools: { listChanged: false }` and so will never send anything on the stream. Each listening client holds a Worker request open indefinitely, and an "this endpoint only returns JSON" guarantee is false for one method nobody thought to test.

## WRONG
```ts
const handler = createMcpHandler(factory, {
  responseMode: "json", // does not apply to subscriptions/listen
});
// capabilities: { tools: { listChanged: false } } -- the stream is opened anyway
```

## RIGHT
```ts
const handler = createMcpHandler(factory, {
  // listen is refused with HTTP 200 and a JSON body:
  // {"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"Subscription limit reached"}}
  maxSubscriptions: 0,
});
```

## NOTES
- Test it: POST `subscriptions/listen` with the full 2026-07-28 headers and `_meta` envelope, assert `Content-Type: application/json` and code `-32603`. Check the header before reading the body: without the option the body never ends, so `await res.text()` waits until the test times out.
- The SDK's `responseMode: "json"` warning says as much ("subscriptions/listen streams are always served over SSE regardless"), which is easy to miss in a log.
- Verified in workerd under `@cloudflare/vitest-plugin` 1.4.0, 2026-10-12.
