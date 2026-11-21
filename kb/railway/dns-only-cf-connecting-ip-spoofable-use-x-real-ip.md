---
tech: railway
tags: [railway, cloudflare, dns-only, grey-cloud, cf-connecting-ip, x-real-ip, x-forwarded-for, rate-limiting, better-auth, spoofing, security]
severity: high
---
# With Cloudflare DNS-only, Railway passes a client's `CF-Connecting-IP` through: key on `X-Real-IP`

## PROBLEM
An app that trusts `CF-Connecting-IP` (common advice for apps behind Cloudflare) is safe only
while Cloudflare actually proxies the hostname. When the record is DNS-only (grey-clouded, e.g.
because Universal SSL cannot cover a two-label subdomain), browsers connect straight to
Railway's edge, which forwards a client-supplied `CF-Connecting-IP` unchanged. Two failures at
once, both silent:
1. Honest requests carry no such header, so a rate limiter keyed on it puts every user in one
   shared bucket (Better Auth: key `no-trusted-ip`, 3 sign-ins per 10 s for everyone).
2. A caller who sets `CF-Connecting-IP` to a different fake address per request gets a fresh
   bucket every time -- the limiter is bypassed, and the shared bucket can be kept full to lock
   everyone else out.

## WRONG
```ts
betterAuth({
  advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
});
```

## RIGHT
```ts
betterAuth({
  // Railway's edge overwrites X-Real-IP on every request (and fills it from CF-Connecting-IP
  // only for connections from Cloudflare's ranges), so this is right proxied or DNS-only.
  // ONE header only: Better Auth takes the first present, so a second, client-writable
  // header would reopen the bypass.
  advanced: { ipAddress: { ipAddressHeaders: ['x-real-ip'] } },
});
```

## NOTES
- Verified live: a request through the public edge carrying forged `X-Real-IP`,
  `CF-Connecting-IP: 198.51.100.77` and `X-Forwarded-For` was keyed in the limiter's Redis
  store (`<ip>|/get-session`) on its real source address, not on any forged value.
- Railway documents `X-Real-IP` as the client IP; the overwrite behaviour is from Railway staff
  answers, not a versioned contract. Requests over the private network (`*.railway.internal`)
  skip the edge and are not sanitized, and staff could not confirm `X-Real-IP` over IPv6.
- `X-Forwarded-For` is not a substitute: Railway does not publish its hop count or proxy CIDRs,
  so `trustedProxies` cannot be configured reliably.
- Diagnosing it in Better Auth: session `ipAddress` is stored as `""`, not NULL, when no IP is
  found, so `count("ipAddress")` reports full coverage -- filter `<> ''`. The "Rate limiting
  could not determine a client IP" warning is logged once per process (module-level flag), so
  one line per deploy means EVERY request is affected, not that it is rare.
- Related: [better-auth/rate-limit-shared-bucket-multi-hop-xff.md](../better-auth/rate-limit-shared-bucket-multi-hop-xff.md).
