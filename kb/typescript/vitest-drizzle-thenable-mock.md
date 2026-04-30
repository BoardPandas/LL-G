---
tech: typescript
tags: [vitest, drizzle-orm, mocking, testing, silent-failure]
severity: high
---
# Vitest mocks of Drizzle queries must return a thenable from `.where()` when production code awaits without `.limit()`

## PROBLEM

Drizzle ORM query objects are thenables: `await db.select().from(t).where(cond)` resolves to an array of rows even though `.then()` is never called explicitly. Production code freely mixes the two terminal forms:

- `await db.select().from(t).where(cond)` — returns the full result array.
- `await db.select().from(t).where(cond).limit(1)` — returns the first row only.

When you mock `db` in Vitest and only support the `.limit()` chain, awaiting a `.where()`-terminated query awaits the chain object itself (not a Promise). The chain object has no iterator, so loops like `for (const row of rows)` throw `TypeError: rows is not iterable` (or worse, silently iterate nothing). The error is far from the mock and looks like a Drizzle bug.

## WRONG

```ts
// Mocks ONLY the .limit() chain. Breaks any production query that awaits .where() directly.
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
  },
}));
```

```ts
// Production code under test:
const rows = await db.select().from(grants).where(cond);  // <- no .limit()
for (const row of rows) { /* TypeError: rows is not iterable */ }
```

## RIGHT

Make `.where()` return an object that is BOTH a thenable AND has a `.limit()` method, so both terminal forms work:

```ts
let dbCallQueue: Array<unknown[]> = [];

function makeQueryChain() {
  return {
    where: vi.fn(() => {
      const data = dbCallQueue.shift() ?? [];
      return {
        then: (
          resolve: (v: unknown[]) => unknown,
          reject?: (e: unknown) => unknown,
        ) => Promise.resolve(data).then(resolve, reject),
        limit: vi.fn(() => Promise.resolve(data)),
      };
    }),
  };
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => makeQueryChain()),
    })),
  },
}));
```

A queue (`dbCallQueue.shift()`) handles ordered multi-call tests (e.g., a function that does an `organization` lookup and then a `partner_memberships` lookup) without trying to detect which Drizzle table object was passed to `.from()`.

## NOTES

- The same pattern applies to `.orderBy()`, `.offset()`, etc. terminals — anywhere production code might await mid-chain.
- For tests that exercise `db.transaction(async (tx) => ...)`, mock `transaction` separately as `vi.fn().mockImplementation(async (fn) => fn(txMock))`.
- Vitest's `mockResolvedValueOnce` chains do not help here because the production code calls `await chain` (no method call), which Vitest's mock doesn't intercept.
- Surfaced while testing partner-scope guards in a multi-broker codebase; `getActivePartnerRole` used `.limit(1)` while `getActiveGrant` did not.
- Related: pin Drizzle ORM to ^0.45.x (see `drizzle-version-pinning.md`); the thenable shape is part of the v0.45 contract.
