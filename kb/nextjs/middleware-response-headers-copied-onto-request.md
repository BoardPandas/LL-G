---
tech: nextjs
tags: [middleware, proxy, headers, bff, csp, nonce, request-headers]
severity: high
---
# Middleware response headers are copied onto the request, so a BFF forwards them upstream

## PROBLEM
When middleware returns `NextResponse.next()`, Next's router (16.x, `server/lib/router-utils/resolve-routes.js`) writes every non-internal header on the middleware *response* into `req.headers` as well (`resHeaders[key] = value; req.headers[key] = value`). A header you set only "for the browser" (a per-request `Content-Security-Policy`, a debug header) silently becomes a request header too.

A route handler that proxies to a backend by forwarding incoming headers (a blocklist-style BFF) then sends that header to the API on every request. Nothing fails; the backend just receives headers it never asked for, including per-request values such as a CSP nonce.

This copy is also why Next's nonce extraction (it reads `content-security-policy` from the request) works even when middleware only sets the response header.

## WRONG
```ts
// middleware.ts: runs for /api/* too, and stamps the response
export default function middleware(request: NextRequest) {
  const response = NextResponse.next()
  response.headers.set('Content-Security-Policy', cspWithNonce())
  return response // the CSP is now on req.headers for the /api route handler
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] }

// app/api/[...path]/route.ts: forwards everything but a blocklist
request.headers.forEach((value, key) => { if (isForwardable(key)) headers[key] = value })
```

## RIGHT
```ts
// Keep proxied routes out of the middleware entirely...
export const config = { matcher: ['/((?!api/|_next/static|_next/image|favicon.ico).*)'] }

// ...and give them their (nonce-free) policy from next.config.js headers(),
// which sets response headers only:
async headers() {
  return [{ source: '/api/:path*', headers: [{ key: 'Content-Security-Policy', value: staticCsp }] }]
}
```

## NOTES
- Verify against the built standalone server with a stub upstream that records request headers; a unit test calling the middleware function cannot see the router's copy.
- If middleware must run on proxied paths, strip the header in the proxy or add it to the forwarding blocklist.
- Related: [middleware-matcher-swallows-health-endpoint.md](middleware-matcher-swallows-health-endpoint.md) (test the matcher in both directions).
