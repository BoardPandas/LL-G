---
tech: cloudflare
tags: [hyperdrive, workers, postgres, connection-pooling, module-scope, database]
severity: high
---
# Hyperdrive proxy URLs are request-scoped -- never cache postgres connections across requests

## PROBLEM
Cloudflare Hyperdrive provides a proxy URL for database connections that handles connection pooling at the proxy level. These proxy URLs are request-scoped -- the proxy endpoint from request 1 is dead by request 2. If you cache a `postgres()` (or any database client) instance at module scope in a Worker, the cached connection points to a dead endpoint on subsequent requests, causing 500 errors on all DB operations after the first request.

Module scope in Cloudflare Workers persists across requests within the same isolate. A common misconception (sometimes even found in code comments) is that "module scope is per-request in Workers" -- this is wrong.

## WRONG
```typescript
// db.ts -- module-scope caching, BREAKS with Hyperdrive
let cachedDb: ReturnType<typeof postgres> | null = null;

export function getDb(url: string) {
  // BAD: connection from request 1 is reused in request 2,
  // but the Hyperdrive proxy URL is dead by then
  if (!cachedDb) {
    cachedDb = postgres(url, { prepare: false });
  }
  return cachedDb;
}
```

## RIGHT
```typescript
// db.ts -- fresh connection per request, Hyperdrive pools for you
import postgres from "postgres";

export function getDb(url: string) {
  // Hyperdrive handles connection pooling at the proxy level.
  // Each request gets a fresh client pointing to the current proxy endpoint.
  return postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
  });
}
```

## NOTES
- Hyperdrive handles connection pooling at the proxy level, so creating a fresh client per request does NOT mean you're opening a new TCP connection to your database each time.
- The `prepare: false` option is required because Hyperdrive does not support prepared statements.
- If your code has a comment saying "module scope is per-request in Workers" -- delete it. Module scope persists across requests within the same isolate.
- This applies to any database client (postgres.js, node-postgres, drizzle), not just postgres.js specifically.
