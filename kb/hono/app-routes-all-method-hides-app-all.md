---
tech: hono
tags: [hono, routing, middleware, app.routes, auth, testing]
severity: high
---
# Filtering app.routes on method ALL hides app.all routes from auth tests

## PROBLEM
A test that proves "every route requires auth" usually enumerates `app.routes` and skips middleware. Hono records `app.use(fn)` as method `ALL` on path `/*` -- but `app.all(path, h)` and a path-scoped `app.use(path, fn)` are method `ALL` too. Filtering `method !== "ALL"` therefore drops real `app.all` handlers, and a route registered with `app.all` before the auth middleware is served anonymously while the test stays green. Only the path tells global middleware apart.

## WRONG
```ts
const routes = app.routes.filter((r) => r.method !== "ALL"); // app.all routes vanish
```

## RIGHT
```ts
const isGlobal = (r: { method: string; path: string }) => r.method === "ALL" && r.path === "/*";
// Probe ALL entries with a real path (GET and POST), skip only global middleware.
const routes = app.routes.filter((r) => !isGlobal(r));

// And assert order directly: nothing but global middleware before auth, pinned count.
const authAt = app.routes.findIndex((r) => r.handler === authenticate);
expect(app.routes.slice(0, authAt).filter((r) => !isGlobal(r))).toEqual([]);
expect(authAt).toBe(4); // app.all("/*", h) also looks global; adding one is a deliberate edit
```

## NOTES
- `app.use(fn)` is stored as `/*`, not `*` (path is merged with the base path).
- Handlers are stored as-is, so `r.handler === authenticate` finds the middleware entry.
- Related: `route-registration-order-on-split.md`.
