---
tech: mcp
tags: [mcp, sdk, createMcpHandler, responseMode, logging, cloudflare-workers, agents]
severity: medium
---
# `responseMode: "json"` logs a console warning every time a handler is built

## PROBLEM
`createMcpHandler(factory, { responseMode: "json" })` calls `console.warn("responseMode: 'json' drops mid-call notifications. ...")` on **every** construction (`@modelcontextprotocol/server` 2.0.0; the `agents/mcp/server` 0.28.0 wrapper passes the option through). There is no once-flag and no option to silence it. The safe pattern builds the handler per request, so no principal or SDK state sits at module scope, which means one stray non-JSON log line per request in an otherwise structured log, and a failing test wherever the console is asserted quiet.

## WRONG
```ts
app.post("/mcp", (c) => {
  const handler = createMcpHandler(factory, { responseMode: "json" }); // warns on every request
  return handler.fetch(c.req.raw, { authInfo });
});
```

## RIGHT
```ts
app.post("/mcp", (c) => {
  // Default "auto": one JSON body unless a tool sends a notification before its result.
  const handler = createMcpHandler(factory);
  return handler.fetch(c.req.raw, { authInfo });
});

// In tests, pin the JSON guarantee on every modern-lane reply instead of relying on the option:
expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
```

## NOTES
- Do not monkey-patch `console.warn` around construction; that hides every other warning in the same window.
- "auto" stays JSON only while no tool emits a mid-call notification (progress, logging). The content-type assertion turns adding one into a failing test.
- `responseMode` governs neither `subscriptions/listen` nor the 2025-era lane. See `subscriptions-listen-holds-sse-stream.md` and `legacy-lane-is-always-sse.md`.
- Verified in workerd under `@cloudflare/vitest-plugin` 1.4.0, 2026-10-12.
