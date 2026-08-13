---
tech: fastify
tags: [fastify, cors, sse, eventsource, reply-raw, plugin-chain, streaming, hijack]
severity: high
---
# Writing through `reply.raw` bypasses the whole Fastify plugin chain, including CORS

## PROBLEM

Fastify plugins attach their headers through the reply lifecycle (`onRequest` /
`onSend` hooks on the Fastify `reply` object). `reply.raw` is the underlying Node
`ServerResponse`. The moment you call `reply.raw.writeHead(status, headers)` you
flush the response head yourself with *only* the headers in that object, and
Fastify treats the reply as hijacked — `onSend` never runs. Everything registered
globally silently stops applying to that one route: `@fastify/cors`,
`@fastify/helmet`, compression, any custom header hook.

This is usually documented as a Better Auth quirk ("`toNodeHandler` bypasses
`@fastify/cors`"), which is misleading — the trap is `reply.raw`, not Better
Auth. Any hand-rolled SSE stream, file download, or proxy handler hits it
independently.

The failure is brutal to spot because **the server is not wrong**. The response
is a clean `200` with a correct body; `curl` shows nothing amiss because curl
does not enforce CORS. Only a browser rejects it, and the console pairs the
contradiction that gives it away:

```
GET https://api.example.com/api/events net::ERR_FAILED 200 (OK)
Access to resource at '...' from origin '...' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

For an SSE stream the damage is total and silent. `EventSource` fires `onerror`,
a typical handler closes the socket, and the app keeps rendering whatever it
fetched on page load. Nothing errors, nothing is empty, the UI just quietly stops
updating — so it reads as "the feature was never wired up" rather than a
transport failure, and a card literally labelled "Live activity" sits there
static. Every cache invalidation riding that stream dies with it, app-wide.

## WRONG

```ts
app.get("/events", async (req, reply) => {
  // Flushes the head with exactly these four headers. @fastify/cors registered
  // back in buildApp() never gets to add Access-Control-Allow-Origin, so the
  // browser drops the stream — while curl and every server-side test pass.
  reply.raw.writeHead(200, {
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream",
    "x-accel-buffering": "no",
  });

  reply.raw.write(`event: update\ndata: ${JSON.stringify(payload)}\n\n`);
});
```

## RIGHT

```ts
// EventSource connects with credentials, and "*" is invalid for a credentialed
// request — echo the exact configured origin, and only when it matches.
function sseCorsHeaders(req: Pick<FastifyRequest, "headers">): Record<string, string> {
  const allowedOrigin = getConfig().PUBLIC_APP_URL;
  if (req.headers.origin !== allowedOrigin) return {};
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-credentials": "true",
    vary: "Origin",
  };
}

app.get("/events", async (req, reply) => {
  reply.raw.writeHead(200, {
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream",
    "x-accel-buffering": "no",
    ...sseCorsHeaders(req),
  });

  reply.raw.write(`event: update\ndata: ${JSON.stringify(payload)}\n\n`);
});
```

## NOTES

- **Reproduce it from the terminal**, since a bare `curl` looks healthy — send an
  Origin and check whether the header comes back:
  `curl -i -H "Origin: https://app.example.com" https://api.example.com/api/events`
  No `access-control-allow-origin` in the output means every browser will drop it.
- **Never `*` for a credentialed connection.** `EventSource(url, {withCredentials: true})`
  and `fetch(..., {credentials: "include"})` both require an exact origin plus
  `Access-Control-Allow-Credentials: true`. A wildcard is rejected outright, which
  looks identical to sending no header at all.
- Add `Vary: Origin` whenever you echo the origin, or a shared cache can serve one
  origin's response to another.
- **Audit by grepping for the escape hatch, not the symptom**: `reply.raw`,
  `reply.hijack()`, and `toNodeHandler` are all the same class of bug. If a route
  uses any of them, no global plugin applies to it.
- Same family, different plugin: compression middleware buffers SSE and stalls the
  stream until the buffer fills. If events arrive late and in bursts rather than
  not at all, suspect compression instead of CORS.
- WebSocket upgrades are *not* affected — they are not subject to CORS — so a
  WS fallback on the same server keeps working and can mislead you into thinking
  the origin config is fine.
