---
tech: rust
tags: [axum, tower, concurrency-limit, router-layer, semaphore, cors, map-response, body-limit, rate-limit, timeout]
severity: medium
---
# axum + tower: ConcurrencyLimitLayer added through Router::layer gets a separate semaphore per route, and per-route CORS misses errors raised by outer layers

## PROBLEM
Two layering surprises:

1. **The limit is per route, not global.** `Router::layer(ConcurrencyLimitLayer::new(n))` applies the layer to each route separately, and each application creates its own semaphore. A router with 20 routes and a limit of 64 allows 20 x 64 requests in flight, not 64. Nothing errors; the limit simply never bites.
2. **CORS headers are missing on outer-layer errors.** CORS headers added with a per-route `map_response` (or any layer inside the route) are only on responses that the route produced. A response generated further out, by the body-size limit, the rate limiter or a timeout layer, never passes through it. A browser then reports an opaque CORS failure instead of the real 413, 429 or 408/504, and the page's code cannot read the status.

## WRONG
```rust
let app = Router::new()
    .route("/a", get(a).layer(map_response(add_cors_headers)))   // CORS inside the route
    .route("/b", post(b).layer(map_response(add_cors_headers)))
    .layer(ConcurrencyLimitLayer::new(64))                       // one semaphore PER ROUTE
    .layer(RequestBodyLimitLayer::new(1 << 20));                 // its 413 has no CORS headers
```

## RIGHT
```rust
let app = Router::new()
    .route("/a", get(a))
    .route("/b", post(b))
    .layer(RequestBodyLimitLayer::new(1 << 20))
    .layer(GlobalConcurrencyLimitLayer::new(64))   // tower::limit: one semaphore shared by every route
    .layer(cors);                                  // outermost: every response passes through it
```

## NOTES
- Any shared semaphore works for the first problem; the point is that the permit pool must be created once, outside the per-route layering.
- For the second, CORS must be the outermost layer over everything that can produce a response.
- Test from the browser's point of view: trigger a 413 and a 429 cross-origin and assert the CORS headers are present on them.
