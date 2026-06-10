---
tech: hono
tags: [routing, refactoring, middleware, route-order, monolith-split]
severity: high
---
# Splitting a monolith Hono route file: registration order is semantic

## PROBLEM
Hono matches overlapping route patterns (`/decks/bulk` vs `/decks/:slug`) in registration order, and `app.use()` middleware only applies to routes registered after it. Splitting a large route file into sub-routers reorders registrations (alphabetical mounts, middleware stranded in one module), so a "pure code movement" refactor silently changes which handler wins or drops auth/validation middleware from a subset of routes. Nothing errors -- the wrong handler just runs, or a gated route becomes ungated.

## WRONG
```ts
// Before the split: order guaranteed within one file
app.post("/decks/bulk", bulkHandler);
app.get("/decks/:slug", bySlugHandler);
app.use(validateParams); // mid-file: only routes registered below get it

// After the split: mounted in arbitrary (alphabetical) order,
// middleware left inside one module
app.route("/", bySlugRouter); // :slug patterns now register before /bulk
app.route("/", bulkRouter);
```

## RIGHT
```ts
// 1. Keep overlapping patterns in the SAME module, preserving relative order.
// 2. Hoist shared middleware to the parent, BEFORE all mounts:
const proxy = new Hono();
proxy.use(validateParams);
proxy.route("/", bulkRouter);   // mount order mirrors the original registration order
proxy.route("/", bySlugRouter);

// 3. Verify with a route-table diff -- zero diff or the split is not done:
const table = app.routes.map((r) => `${r.method} ${r.path}`).join("\n");
// dump before the refactor, dump after, diff the two
```

## NOTES
The same class of bug exists in Express. The route-table diff catches order/path drift but NOT middleware coverage -- separately spot-check one auth-gated route from each new module (call it unauthenticated, expect a rejection).
