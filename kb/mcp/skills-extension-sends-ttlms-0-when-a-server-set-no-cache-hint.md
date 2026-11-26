---
tech: mcp
tags: [mcp, sdk, skills, ttlMs, cache-hint, gateway, aggregation]
severity: medium
---
# The SDK skills extension sends `ttlMs: 0` when a server set no cache hint, so 0 means "no hint"

## PROBLEM
A skills listing from the SDK extension carries `ttlMs`. When the server configured no cache hint, the extension still sends `ttlMs: 0`. A gateway that aggregates several upstream listings and takes the smallest `ttlMs` (so it never lets a client cache longer than any upstream allows) reads that 0 as "never cache". One such upstream makes the gateway tell every client not to cache any listing, which multiplies list traffic for everyone.

## WRONG
```ts
const asked = listings.flatMap((l) => (l.ttlMs === undefined ? [] : [l.ttlMs]));
const ttlMs = Math.min(DEFAULT_TTL_MS, ...asked);    // one upstream with 0 -> 0 for everyone
```

## RIGHT
```ts
const isPositive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

const asked = listings.flatMap((l) => (isPositive(l.ttlMs) ? [l.ttlMs] : []));   // 0 = no hint
const ttlMs = Math.min(DEFAULT_TTL_MS, ...asked);
```

## NOTES
- Honour only a positive value. If an upstream really needs "do not cache", it has to say so another way; do not infer it from 0.
- The same applies to any numeric hint where 0 is a default rather than a request: check what the producer sends when nothing was configured.
- Test with a listing that carries `ttlMs: 0` and assert the aggregate is unchanged.
