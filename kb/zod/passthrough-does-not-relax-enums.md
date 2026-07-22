---
tech: zod
tags: [zod, validation, enum, passthrough, express, api, http-400]
severity: medium
---
# .passthrough() allows unknown KEYS, not unknown ENUM VALUES

## PROBLEM
A request-body schema built with `.passthrough()` reads as permissive, so it is easy to assume the validator will not block a newly supported field value. It will. `.passthrough()` only governs *unrecognized keys* on an object: it stops Zod stripping (or, in strict mode, rejecting) properties the schema never declared. It has no effect on the validation of keys the schema *does* declare.

So when a bulk/action endpoint discriminates on something like `op: z.enum(['update', 'delete'])`, adding a new operation to the route handler alone is not enough. The schema rejects the request before the handler ever runs, and the client sees a generic `400 invalid request`. You then debug the handler you just wrote and correctly conclude it looks fine, because it is fine and never executed.

The same trap applies to any narrowing declared on an existing key: `z.literal`, `z.union` of literals, `.refine`, `min`/`max`. `.passthrough()` relaxes none of it.

## WRONG
```ts
// schemas/tickets.ts -- untouched
export const bulkActionSchema = z
  .object({
    ids: z.array(z.number()).min(1).max(500),
    op: z.enum(['update', 'delete']).optional(),
    // ...
  })
  .passthrough();   // <- reads as "extra stuff is fine". It isn't, for `op`.

// routes/bulk.ts -- new op implemented here only
if (op === 'mark_read') {          // unreachable
  return res.json({ ok: true, affected: await markRead(ids) });
}
// => POST { ids, op: 'mark_read' } -> 400 "invalid request",
//    with issue: invalid_enum_value at path ["op"]
```

## RIGHT
```ts
// Widen the enum in the SAME change as the handler. The two are one unit.
export const bulkActionSchema = z
  .object({
    ids: z.array(z.number()).min(1).max(500),
    op: z.enum(['update', 'delete', 'mark_read', 'mark_unread']).optional(),
    // ...
  })
  .passthrough();
```

```ts
// And surface the reason, so the next 400 is self-diagnosing rather than generic.
const parsed = bulkActionSchema.safeParse(req.body ?? {});
if (!parsed.success) {
  return res.status(400).json({ error: 'invalid request', details: zodIssues(parsed.error) });
}
```

## NOTES
- Quick check when an endpoint 400s on a value you believe you implemented: log `parsed.error.issues`. `invalid_enum_value` with `path: ["op"]` names the culprit immediately, and `received` shows the value the schema refused.
- Zod v4 renames the object modes (`z.looseObject` / `z.strictObject` alongside `.passthrough()` / `.strict()`), but the semantics here are unchanged: the mode is about unknown keys only.
- Grep for the schema whenever you extend a discriminator: a route handler and its validator commonly live in different files (`routes/` vs `schemas/`), which is why the two drift.
