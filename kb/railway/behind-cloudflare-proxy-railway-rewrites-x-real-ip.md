---
tech: railway
tags: [railway, cloudflare, proxied, cf-connecting-ip, x-real-ip, client-ip, workers, rate-limiting, audit]
severity: medium
---
# Behind Cloudflare's proxy, Railway already rewrites X-Real-IP from CF-Connecting-IP

## PROBLEM
When a hostname on Railway is orange-clouded, the peer that reaches Railway's edge is a
Cloudflare server. You would expect `X-Real-IP` (and the `srcIp` in Railway's HTTP logs) to
be that Cloudflare address, and plan a migration around it. Measured on a proxied production
host (response `server: cloudflare`), they are the browser's real address instead: Railway's
edge substitutes `CF-Connecting-IP` for connections from Cloudflare's ranges. This is
undocumented, so it can change without notice.

Two consequences that are easy to miss:
1. An app-side "if `X-Real-IP` is in Cloudflare's ranges, use `CF-Connecting-IP`" check never
   fires today. It is still worth having as the fallback if Railway stops substituting, but a
   test against production cannot exercise it.
2. Railway trusts `CF-Connecting-IP` from *any* Cloudflare-range peer, not just your zone. In a
   same-zone Worker subrequest Cloudflare copies `CF-Connecting-IP` from a header the Worker
   sets, so whoever controls a Cloudflare zone in front of a hostname routed to your Railway
   service (a customer's vanity domain, for example) can choose the client IP your app sees.
   Neither Railway nor your app can tell. Cross-zone Worker calls are safe: Cloudflare pins
   `CF-Connecting-IP` to a fixed Worker address there.

## WRONG
```ts
// Assumes x-real-ip is Cloudflare's address once proxied, and that any
// cf-connecting-ip arriving from a Cloudflare range came through your own zone.
const ip = isCloudflare(req.headers['x-real-ip'])
  ? req.headers['cf-connecting-ip']
  : req.headers['x-real-ip'];
```

## RIGHT
```ts
// Keep the range check as a fallback (Railway already substitutes today).
const ip = resolveClientIp(req.headers['x-real-ip'], req.headers['cf-connecting-ip']);
// To prove a request came through YOUR zone, add a Transform Rule in your zone
// that sets a secret request header, and require it in the app (constant-time
// compare) before trusting any proxied client IP for rate limits or audit rows.
```

## NOTES
- Verify on your own host: compare Railway's HTTP-log `srcIp` for a proxied hostname with the
  `server: cloudflare` response header; real client addresses there mean the edge substitutes.
- Related: [dns-only-cf-connecting-ip-spoofable-use-x-real-ip.md](dns-only-cf-connecting-ip-spoofable-use-x-real-ip.md)
  (DNS-only hosts pass a client's `CF-Connecting-IP` through untouched).
