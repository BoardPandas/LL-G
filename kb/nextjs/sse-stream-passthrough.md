---
tech: nextjs
tags: [sse, server-sent-events, app-router, route-handler, bff, streaming, proxy, eventsource]
severity: high
---
# App Router route handler proxying SSE must stream the body, not JSON-decode it

## PROBLEM
A shared BFF proxy helper that buffers and JSON-decodes the upstream response (`const data = await response.json(); return NextResponse.json(data)`) silently breaks Server-Sent Events. The browser EventSource either never receives events or only gets them all at once after the upstream stream closes, because the helper waits for the full body before responding. Nothing errors: it looks like the SSE endpoint is "not firing."

## WRONG
```ts
// app/api/v1/events/stream/route.ts — reuses the generic JSON proxy
export async function GET(req: NextRequest) {
  return proxyToBackend(req, '/v1/events/stream');
  // proxyToBackend does: const data = await res.json(); return NextResponse.json(data)
  // -> buffers the whole stream, EventSource never sees live events
}
```

## RIGHT
```ts
// Dedicated streaming handler: pipe upstream.body straight through.
export async function GET(req: NextRequest): Promise<Response> {
  const url = `${API_URL}/v1/events/stream${req.nextUrl.search || ''}`;
  const headers: Record<string, string> = {};
  const token = req.cookies.get('better-auth.session_token')?.value;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const cookie = req.headers.get('cookie');
  if (cookie) headers['cookie'] = cookie;

  const upstream = await fetch(url, { method: 'GET', headers, cache: 'no-store' });

  const out = new Headers();
  out.set('Content-Type', upstream.headers.get('content-type') || 'text/event-stream');
  out.set('Cache-Control', 'no-cache, no-transform');
  out.set('X-Accel-Buffering', 'no'); // defeat nginx/Northflank ingress buffering
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
```

## NOTES
EventSource cannot send custom headers, so pass MSP/tenant scoping as a query param and validate it server-side. Forward the auth cookie/bearer exactly as the JSON proxy does. Verified end to end: an event reached the browser in ~260ms through the Next BFF + Northflank ingress with these headers. The server side also has a buffering trap: see the express entry "Express global compression() buffers SSE responses".
