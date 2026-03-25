---
tech: typescript
tags: [async, singleton, race-condition, initialization, database]
severity: high
---
# Async singleton race condition: check-then-await creates duplicates

## PROBLEM

A common pattern for lazy-initializing an async resource checks if the resolved instance is null, then awaits creation. But multiple concurrent callers can pass the null check before the first `await` resolves, creating duplicate instances. For database connections, this means multiple pools or file handles, wasting resources and potentially corrupting state.

## WRONG

```typescript
let dbInstance: Database | null = null;

async function getDb(): Promise<Database> {
  if (!dbInstance) {
    // Multiple callers reach here before the first load() resolves
    dbInstance = await Database.load("sqlite:app.db");
  }
  return dbInstance;
}
```

## RIGHT

Store the **promise**, not the resolved value. All concurrent callers share the same in-flight promise:

```typescript
let dbPromise: Promise<Database> | null = null;

function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:app.db");
  }
  return dbPromise;
}
```

## NOTES

- This applies to any async singleton: database connections, auth tokens, config loaders, WebSocket connections.
- The promise-based approach also naturally handles errors -- if `load()` rejects, you may want to reset `dbPromise = null` so retries can attempt again.
- In Node.js/Deno server contexts, this is especially critical because multiple concurrent requests hit the singleton simultaneously at startup.
- Discovered in RepoTracker `drizzle-bridge.ts` during code review.
