---
tech: architecture
tags: [cache, ttl, source-of-truth, prefetch, state-management, fetch]
severity: medium
---
# A transient client cache must never become a second source of truth

## PROBLEM
Adding a short-TTL client-side cache to speed up re-entry or hover-prefetch is easy to get
subtly wrong: if it caches failures, holds state the server should own, or swallows errors, it
silently serves stale or wrong data and drifts from the server -- the classic "redundant store
drifts" bug, just with a timer. The speedup is real; the danger is letting the cache quietly
become authoritative.

## WRONG
```js
const cache = new Map();
async function jget(url) {
  if (cache.has(url)) return cache.get(url);     // also returns cached errors / nulls forever
  const data = await fetch(url).then(r => r.json()).catch(() => null); // failure cached as null
  cache.set(url, data);                          // 404/500 now sticky until reload
  return data;
}
```

## RIGHT
```js
const cache = new Map(); // url -> { at, promise }
const TTL = 120_000, MAX = 50;

function cachedJget(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL) return hit.promise;

  // store the REAL promise so a rejection still propagates to the caller's error path
  const promise = fetch(url).then(r => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });
  promise.catch(() => cache.delete(url));        // EVICT on failure: 404/500 never sticky
  cache.set(url, { at: Date.now(), promise });
  if (cache.size > MAX) cache.delete(cache.keys().next().value);
  return promise;                                // server stays authoritative; cache only skips a refetch
}
```

## NOTES
- Four rules keep a transient cache safe: (1) cache only successes, (2) store the real promise so
  errors still reach the caller, (3) evict on failure, (4) keep the server authoritative -- the
  cache only saves a refetch within the TTL, it never owns state.
- Good fit: hover/focus prefetch of a detail payload, brief landing-payload cache for instant
  re-entry. Bad fit: anything mutated elsewhere that must be live.
- Related: [[check-sibling-services-before-parallel-store]] (the durable-store version of the
  same "don't create a drifting copy" failure).
