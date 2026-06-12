---
tech: nextjs
tags: [custom-server, webpack-runtime, module-singleton, in-memory-state, api-routes, session-store, cache-invalidation, source-of-truth]
severity: high
---
# Module-level singletons are NOT shared between a Next.js custom server and Next API routes

## PROBLEM
In a custom-server Next.js setup (a `server.ts` that mounts both an Express app and the Next request handler in one process), a module imported by BOTH the custom server code and a Next route handler (`app/api/*` or `pages/api/*`) resolves to TWO DIFFERENT instances. Next bundles its route handlers in a separate webpack runtime from the custom server's own module graph, so a module-level singleton (an in-memory `Map`, cache, event emitter, connection registry, session store) is duplicated. A write from the API route lands on a different copy than the one the custom server reads, and vice versa. There is no error.

Symptom: cross-runtime in-memory invalidation/coordination silently no-ops. Classic case: an API route updates config/credentials in the DB and then calls `invalidateSession()` / `cache.delete()` on an in-memory map, expecting the gateway side to pick it up, but the gateway keeps serving stale state until the process restarts, which rebuilds both runtimes from scratch and masks the bug as "it only works after a restart."

## WRONG
```ts
// src/gateway/sessions.ts -- module-level singleton
export const sessions = new Map<string, Session>();

// server.ts (custom server) -- the Express gateway reads/writes `sessions`
import { sessions } from "./src/gateway/sessions";
app.use("/mcp", gatewayUsing(sessions));

// app/api/credentials/route.ts -- Next route handler, runs in Next's webpack runtime
import { sessions } from "@/gateway/sessions";
export async function POST(req: Request) {
  await upsertCredential(userId, provider, creds);
  // Looks correct, silently no-ops: this `sessions` Map is a SECOND instance,
  // not the one the Express gateway serves from. The gateway never sees the
  // deletion and keeps using the stale, baked-in credential until restart.
  for (const [id, s] of sessions) if (s.userId === userId) sessions.delete(id);
}
```

## RIGHT
```ts
// Do not coordinate via a shared in-memory singleton across the boundary.
// The DB is the single source of truth; stamp each session with a version and
// re-validate it per request on the gateway side. The API route only writes.

// gateway (custom-server side): re-check freshness when reusing a session
const current = await getCredentialVersion(userId, provider); // SELECT updated_at
if (current !== session.credVersion) {
  await session.transport.close();          // rebuild against fresh credential
  return res.status(404).json(reinitError); // client re-initializes the session
}

// app/api/credentials/route.ts: just write the source of truth, no cross-runtime call
export async function POST(req: Request) {
  await upsertCredential(userId, provider, creds); // sets updated_at = now()
}
```

## NOTES
- Applies to any "single process, two webpack runtimes" Next custom-server deployment (Express, Fastify, plain http), not just Express, and is worse across multiple replicas where even same-runtime in-memory state is not shared.
- Three robust fixes: (a) keep the state owned entirely on one side and have the other reach it over HTTP/IPC; (b) use an external shared store (Postgres/Redis) as the source of truth; (c) re-validate against the source of truth per request via a cheap version/`updated_at` stamp (shown above). A short TTL cache over the version probe bounds DB load if request volume is high.
- Real example: the wellforce MCP bridge. The Express gateway kept an in-memory session map that baked a credential in at connect time; the `/api/credentials` Next route could not invalidate those sessions by importing the same `sessions` module. Fixed with the per-request `updated_at` version check.
- Related: the architecture index entries on source-of-truth drift and redundant stores.
