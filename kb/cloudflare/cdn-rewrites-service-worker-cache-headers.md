---
tech: cloudflare
tags: [cdn, cache-control, service-worker, nextjs, acceptance]
severity: high
---
# A CDN can rewrite service-worker cache headers after origin checks pass

## PROBLEM

A built Next.js host and its direct Railway origin returned the intended service-worker
header `Cache-Control: no-cache, max-age=0, must-revalidate`. Local browser acceptance
passed. The production Cloudflare hostname served the exact same JavaScript bytes, MIME
type and worker scope but changed that header to `max-age=14400, must-revalidate`.
HTTP 200 and a matching asset hash did not prove the update policy reached the browser.

Cloudflare Browser Cache TTL can replace a shorter origin lifetime. Do not infer the exact
responsible account rule from a response header alone. Inspect the public response and, when
necessary, the CDN configuration. Service-worker registration's `updateViaCache: 'none'`
controls the browser's HTTP cache; it does not prove that an intervening CDN contacts origin.

## WRONG

```js
// This checks only the build, not the browser-facing production response.
const response = await fetch('http://localhost:3001/sw.js');
assert.match(response.headers.get('cache-control'), /no-cache/);
// Declare deployment acceptance complete after a successful source build or HTTP 200.
```

## RIGHT

Verify GET through the public hostname after deployment, as well as the direct origin.
For a small worker script that should never be stored in HTTP caches, send explicit storage
directives and ensure CDN rules honor them:

```http
Cache-Control: no-cache, no-store, max-age=0, must-revalidate
CDN-Cache-Control: no-store
Service-Worker-Allowed: /
```

```js
const response = await fetch('https://dashboard.example.com/sw.js', { redirect: 'manual' });
assert.equal(response.status, 200);
assert.match(response.headers.get('content-type'), /javascript/);
assert.match(response.headers.get('cache-control'), /no-store/);
assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
assert.equal(response.headers.get('service-worker-allowed'), '/');
assert.equal(await response.text(), expectedWorkerSource);
```

Keep rollout disabled until the public check passes. A cache rule that ignores origin
directives may still require a path-specific correction; do not assume extra headers defeat
every policy. Do not disable caching for unrelated assets. Record the served revision and
public headers separately from CI success.

## NOTES

- `no-cache` allows storage with revalidation; `no-store` prohibits storage. Choose the
  contract intentionally rather than treating the two as synonyms.
- This concerns HTTP caching of the worker script, not the CacheStorage API or the browser's
  installed service-worker lifecycle. No fetch handler, private-response cache, `skipWaiting`,
  or forced client navigation is needed to correct it.
- Purging the CDN does not clear already populated browser caches.
- [Cloudflare Browser Cache TTL](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/)
- [Cloudflare CDN-Cache-Control precedence](https://developers.cloudflare.com/cache/concepts/cdn-cache-control/)
- Observed during SupportForge technician Web Push deployment on 2026-10-13: source commit
  `cddb636002ac4bc5a3a8cd74bea8a2623f9e60a4`; scoped correction
  `186b409d9b1f216c97218032aa178b2dd8511eb6`. After the correction, public GET retained
  both no-cache/no-store and `CDN-Cache-Control: no-store`, Cloudflare reported `BYPASS`,
  and the real Chromium harness passed against the public asset's headers and exact bytes.
