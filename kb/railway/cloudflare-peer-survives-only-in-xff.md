---
tech: railway
tags: [railway, cloudflare, x-forwarded-for, x-real-ip, cf-connecting-ip, client-ip]
severity: medium
---
# After Railway's Cloudflare swap, X-Forwarded-For[0] is the only header naming the real peer

## PROBLEM
For a Cloudflare IPv4 peer Railway's edge copies the zone's `CF-Connecting-IP` into `X-Real-IP`, so `X-Real-IP` no longer says which Cloudflare server connected. The real peer is kept only as the first entry of `X-Forwarded-For`, written as `<peer>, <edge hop>`. A caller's own `X-Forwarded-For` is discarded (measured on a probe, 2026-11-21). Code that trusts `X-Real-IP` alone cannot tell a request relayed by a foreign Cloudflare zone from a genuine browser.

## WRONG
```ts
// relayed by another zone: X-Real-IP is that zone's chosen value
const ip = req.headers['x-real-ip'];
```

## RIGHT
```ts
// accept XFF[0] only in the exact two-entry shape the edge writes,
// and only when it is a Cloudflare address
const entries = String(req.headers['x-forwarded-for'] ?? '').split(',').map((e) => e.trim());
const peer = entries.length === 2 && isCloudflareAddress(entries[0]) ? entries[0] : undefined;
const ip = peer ?? req.headers['x-real-ip'];
```

## NOTES
- Trust `cf-connecting-ip` only with a zone-level secret header (see behind-cloudflare-proxy-railway-rewrites-x-real-ip).
- Requiring the two-entry shape matters: an appended chain puts a caller-written address at XFF[0].
- Tradeoff: every user behind one foreign proxied zone shares that zone's few Cloudflare addresses for per-IP limits.
