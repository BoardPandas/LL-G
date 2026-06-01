---
tech: typescript
tags: [express, req-params, route-handler, tsc, type-widening]
severity: medium
---
# req.params.id is typed string | string[] and breaks tsc on nested routers

## PROBLEM
On an Express route handler, `req.params.id` is not always `string`. With the
installed `@types/express`, route param access can widen to `string | string[]`
(and `string | undefined`). Passing it straight into a helper typed `(id: string)`
fails the build with `TS2345: Argument of type 'string | string[]' is not
assignable to parameter of type 'string'`. The handler looks obviously correct,
and the same code "works" in another file where inference happened to land on
`string`, so the error is confusing.

## WRONG
```typescript
router.get('/v1/tickets/:id/custom-values', async (req, res) => {
  // TS2345: 'string | string[]' is not assignable to 'string'
  const ticket = await loadTicketForMsp(req.params.id, mspId);
});
```

## RIGHT
```typescript
router.get('/v1/tickets/:id/custom-values', async (req, res) => {
  const ticket = await loadTicketForMsp(String(req.params.id), mspId);
});
```

## NOTES
Coerce with `String(req.params.x)` at the boundary (or destructure with an
explicit `const { id } = req.params as { id: string }` only when you trust the
route). This is a build-time failure (medium), not silent, but the message points
at the call site rather than the real cause (param typing), so it wastes time.
