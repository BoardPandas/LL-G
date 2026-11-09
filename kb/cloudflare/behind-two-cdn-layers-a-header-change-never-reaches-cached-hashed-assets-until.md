---
tech: cloudflare
tags: [cdn, cache-purge, railway, nextjs, security-headers, hsts, csp, immutable]
severity: high
---
# Behind two CDN layers, a header change never reaches cached hashed assets until both are purged inner-first, and an outer colo can refill from an unpurged inner edge

## PROBLEM
When an origin sits behind two caches (e.g. a host CDN such as Railway's, then Cloudflare), new response headers never appear on cached `immutable` assets until both caches are purged, inner first, and one outer colo can still re-cache a stale copy from an inner edge whose purge has not propagated.
Cached responses keep the headers they were first served with. Hashed assets like `/_next/static/*` fonts and unchanged CSS keep the same URL across builds and are cached for a year (`max-age=31536000, immutable`). After deploying new security headers (HSTS, nosniff, CSP), pages showed them but fonts and CSS did not, so a DAST rescan would keep flagging those URLs. The origin was correct the whole time, so a cache-busted fetch looks fine while real URLs stay stale.

## WRONG
```bash
# Purge only the outer CDN, or purge outer before inner:
curl -X POST .../zones/<zone>/purge_cache -d '{"hosts":["app.example.com"]}'
# The outer cache refills from the inner CDN's stale copy (old headers).

# Verify once and call it done:
curl -sI https://app.example.com/_next/static/media/font.woff2   # HEAD, one colo
```

## RIGHT
```bash
# 1. Purge the inner (host) CDN first, then the outer one.
railway-purge --service <dashboard> --scope all
curl -X POST .../zones/<zone>/purge_cache -d '{"hosts":["app.example.com"]}'

# 2. Verify with GET, several times per URL, and read which colo answered.
for i in 1 2 3 4; do
  curl -s -o /dev/null -D - https://app.example.com/_next/static/chunks/x.css \
    | grep -iE '^(strict-transport-security|x-cache|age|cf-cache-status|cf-ray):' | tr '\r\n' '  '; echo
done
# A colo still HIT with no new headers (small Age, x-cache: HIT) refilled from an
# inner edge before its purge propagated: purge inner again, then outer again.

# 3. Show what origin sends, bypassing both caches:
curl -s -o /dev/null -D - 'https://app.example.com/_next/static/chunks/x.css?cb=123'
```

## NOTES
- Seen once: the first inner→outer purge round left one Cloudflare colo (IAD) serving the header-less copy with `Age: 15`. A second round cleared it.
- Cloudflare purge by hostname works on the Free plan.
- Purging everything also drops the previous build's chunks, so open tabs on the old build hit 404 ChunkLoadErrors until they reload.
- Use GET, not HEAD. Some CDNs report HEAD as uncached (see railway/head-request-reports-cache-dynamic).
- Related: cloudflare/cdn-rewrites-service-worker-cache-headers.
