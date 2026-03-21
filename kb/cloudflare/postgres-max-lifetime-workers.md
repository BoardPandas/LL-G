---
tech: cloudflare
tags: [postgres, workers, max-lifetime, connection, hyperdrive]
severity: high
---
# postgres.js max_lifetime creates stale connections with module-scope caching

## PROBLEM
Setting `max_lifetime: 1` (1 second) on a postgres.js instance tells it to tear down connections after 1 second. When combined with module-scope caching in Cloudflare Workers, the cached postgres instance has its internal connection torn down, but the instance reference is still reused. The first request works, then subsequent requests get a dead connection from the cached instance.

Additionally, `max_lifetime: null` and `max_lifetime: 0` may crash postgres.js entirely.

## WRONG
```typescript
// Module-scope cached instance with aggressive teardown
let db: ReturnType<typeof postgres> | null = null;

export function getDb(url: string) {
  if (!db) {
    db = postgres(url, {
      max_lifetime: 1,  // tears down connection after 1 second
      prepare: false,
    });
  }
  return db;  // after 1 second, this instance's connection is dead
}
```

## RIGHT
```typescript
// Option A: Fresh instance per request (best for Hyperdrive)
export function getDb(url: string) {
  return postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    // Do NOT set max_lifetime -- let Hyperdrive manage connection lifecycle
  });
}

// Option B: If you must cache, use a reasonable lifetime (not for Hyperdrive)
export function getDb(url: string) {
  return postgres(url, {
    max_lifetime: 60 * 5,  // 5 minutes, not 1 second
    prepare: false,
  });
}
```

## NOTES
- For Hyperdrive specifically, do not cache connections at all (see `hyperdrive-connection-caching.md`).
- Only use positive integers for `max_lifetime`. Null and 0 may cause crashes.
- If you omit `max_lifetime`, postgres.js uses its default behavior which is generally safe.
