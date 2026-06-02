---
tech: express
tags: [sse, server-sent-events, compression, middleware, streaming, buffering, eventsource, node]
severity: high
---
# Express global compression() buffers SSE responses

## PROBLEM
`app.use(compression())` registered globally wraps every response in a zlib Transform stream. For a `text/event-stream` (SSE) endpoint this buffers the stream: events are batched or never flushed, so the browser EventSource sees nothing until the connection closes. It looks like the SSE route "isn't emitting," but the handler is writing fine; compression is holding the bytes.

## WRONG
```ts
app.use(compression()); // applies to every route, including the SSE stream

router.get('/v1/events/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.write(`data: ${JSON.stringify(ev)}\n\n`); // buffered by zlib, never reaches client live
});
```

## RIGHT
```ts
// Exclude the SSE path from compression via a filter.
app.use(compression({
  filter: (req, res) =>
    req.path === '/v1/events/stream' ? false : compression.filter(req, res),
}));

router.get('/v1/events/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');     // defeat nginx / Northflank ingress buffering
  res.setHeader('Content-Encoding', 'identity'); // belt-and-suspenders vs compression
  res.flushHeaders();
  res.write(': connected\n\n');
  const hb = setInterval(() => res.write(': hb\n\n'), 25000); // keep the connection alive
  req.on('close', () => clearInterval(hb));
});
```

## NOTES
If path-normalization middleware rewrites `/api/v1/*` to `/v1/*`, it runs before `compression()`, so match the normalized path in the filter. The 25s heartbeat keeps proxies from idling out the connection. The other half of the SSE buffering trap is the BFF layer: see the nextjs entry "App Router route handler proxying SSE must stream the body, not JSON-decode it". Verified end to end: event reached the browser in ~260ms through Express + a Next BFF + Northflank ingress.
