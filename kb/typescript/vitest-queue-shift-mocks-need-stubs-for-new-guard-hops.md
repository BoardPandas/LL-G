---
tech: typescript
tags: [vitest, mocking, drizzle, route-tests, auth-guards]
severity: medium
---
# Adding a new DB call inside a shared auth guard breaks every queue-shifting test mock at once

## PROBLEM
A common pattern for testing API routes that use Drizzle is to mock `@/lib/db` with a queue of return values that gets shifted on each `db.select().from(...).where(...)` call:
```ts
let dbCallQueue: Array<unknown[]> = [];
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(() => makeThenable()) },
}));
function makeThenable() {
  const chain = {} as Record<string, unknown>;
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.then = (resolve: (v: unknown[]) => unknown) => {
    const data = dbCallQueue.shift() ?? [];
    return Promise.resolve(data).then(resolve);
  };
  return chain;
}
```
This works great until the auth guard chain you compose with (`withOrgAdmin`, `withPartnerAdmin`, etc.) gains a new internal DB call — say, a tenant lifecycle check or a feature-flag lookup. Every test that previously seeded N entries in `dbCallQueue` now gets one too few because the new guard hop consumes a slot before the route handler runs. The route handler then sees the wrong row at every position, and tests fail with confusing assertions like "expected 200 to be 404" or "expected 409 to be 500" — none of which point at the actual cause.

The trap: the test stack is correct in isolation; the failure mode is "downstream production-code change broke an unrelated test file's mocked queue ordering." Two-line guard changes can cascade through 6+ test files.

## WRONG
```ts
// settings/route.test.ts
beforeEach(() => { dbCallQueue = []; });

it("200 on happy path", async () => {
  dbCallQueue.push([{ id: "u1", role: "partner_admin" }]); // membership row
  dbCallQueue.push([{ id: "p1", name: "Acme" }]);          // partner row for the route
  // If a new guard hop runs between these two, the partner row goes to the
  // guard's lifecycle check and the route sees [] -> 404 instead of 200.
  const res = await PATCH(makeReq({ name: "Acme 2" }), { params: Promise.resolve({ partnerId: "p1" }) });
  expect(res.status).toBe(200);
});
```

## RIGHT
Mock the new dependency separately so it short-circuits without consuming a queue slot:
```ts
// at the top of the test file, before any imports of the route
vi.mock("@/lib/auth/partner-lifecycle", () => ({
  getPartnerLifecycle: vi.fn().mockResolvedValue(null), // guard sees null, passthrough
}));

// existing dbCallQueue + makeThenable mock stays unchanged
```

Apply this stub everywhere you have a queue-shifting DB mock — it is safer to add the line preemptively to every route test than to remember which guards now do which DB calls.

## NOTES
- The deeper fix is to stop relying on queue-shifting mocks entirely and instead mock at the helper level (e.g., `vi.mock("@/lib/db/queries/get-partner")` returning specific rows). Queue-shifting is brittle to any internal restructuring.
- Distinct from `vitest-drizzle-thenable-mock`, which covers queries that await `.where()` directly without `.limit()`. This entry is about the queue-position drift caused by upstream guard changes.
- This same failure mode hits any "guard chain extension" pattern — entitlement checks, feature-flag lookups, audit logging — not just lifecycle checks.
- Diagnostic hint: when the failure says "expected X to be 404" and the route works in production, suspect a queue ordering shift before suspecting the route handler.
