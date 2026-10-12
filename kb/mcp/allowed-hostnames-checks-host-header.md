---
tech: mcp
tags: [mcp, agents, createMcpHandler, dns-rebinding, host-header, custom-domain, cloudflare-workers, vitest]
severity: high
---
# `allowedHostnames` checks the Host header, and a custom domain gets no Host check by default

## PROBLEM
`createMcpHandler` from `agents/mcp/server` (0.28.0) validates the request's `Host` **header** against `allowedHostnames`, not the hostname in `request.url`. When the option is omitted, the default list is picked from the URL: a localhost URL gets the localhost list, a `*.workers.dev` URL gets its own hostname, and **any other hostname (your custom domain) gets no Host check at all**. So the workers.dev preview has DNS-rebinding protection and production does not.

Once `allowedHostnames` is set, a request with no Host header is refused `403` `{"code":-32000,"message":"Missing Host header"}`. In workerd and `@cloudflare/vitest-plugin`, `new Request(url)` carries no Host header, so every test call is 403 until the test sets one.

## WRONG
```ts
const handler = createMcpHandler(factory); // on api.example.com: no Host check runs

// test, after adding allowedHostnames: 403 "Missing Host header"
await handler.fetch(new Request("https://api.example.com/mcp", { method: "POST", headers, body }));
```

## RIGHT
```ts
const handler = createMcpHandler(factory, { allowedHostnames: [config.apiHost] });

// test: workerd does not derive Host from the URL
await handler.fetch(
  new Request(`https://${API_HOST}/mcp`, {
    method: "POST",
    headers: { Host: API_HOST, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body,
  }),
);
```

## NOTES
- Because the header is what is checked, a request that reaches `/mcp` under another hostname bound to the same Worker (a UI host, a preview alias) is refused too, which is useful defence in depth.
- Test three cases: the right Host (served), a wrong Host (403), no Host (403).
- The Origin check and CORS have their own permissive defaults; see `agents-handler-default-cors-and-origin.md`.
- Verified 2026-10-12.
