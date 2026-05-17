---
tech: typescript
tags: [async, promises, migration, refactor, truthy-check, sqlite, postgres]
severity: high
---
# Migrating a function from sync to async silently breaks `if (!x)` guards

## PROBLEM

When a function changes from synchronous to asynchronous (e.g. swapping a sync DB driver like `better-sqlite3` for an async one like `node-postgres`), every call site written for the sync version still type-checks -- but some of them now do the wrong thing at runtime, with no compile error.

A caller like `const rule = getRule(n); if (!rule) { ... }` was correct when `getRule` returned `Rule | undefined`. After `getRule` becomes `Promise`-returning, `rule` is a `Promise`. A Promise is always truthy, so `if (!rule)` is always false and the "not found" branch becomes dead code.

`tsc` does NOT flag this: assigning a `Promise<T>` to an untyped `const` and testing it with `!` is legal TypeScript. Direct property access (`rule.body`) *would* fail to compile, so those call sites get caught -- but pure truthiness checks, and passing the value where `any`/`unknown` is accepted, slip through silently. The result is wrong output, not a crash.

## WRONG

```typescript
// getRule WAS:  function getRule(n: string): Rule | undefined
// getRule NOW:  async function getRule(n: string): Promise<Rule | undefined>

function findHallucinatedRules(text: string): string[] {
  const missing: string[] = [];
  for (const n of extractRuleNumbers(text)) {
    const rule = getRule(n);    // a Promise now -- ALWAYS truthy
    if (!rule) missing.push(n); // dead branch: never runs, finds nothing
  }
  return missing;
}
```

## RIGHT

```typescript
// When a function goes async, audit EVERY caller -- not just the ones
// that fail to compile. Then make the caller async and propagate upward.

async function findHallucinatedRules(text: string): Promise<string[]> {
  const missing: string[] = [];
  for (const n of extractRuleNumbers(text)) {
    const rule = await getRule(n); // await -> Rule | undefined
    if (!rule) missing.push(n);
  }
  return missing;
}
// ...then update findHallucinatedRules' own callers to `await` it in turn.
```

## NOTES

- The compile-clean trap is specific to truthy/falsy tests and to passing the Promise where `any`/`unknown` is accepted. Property access and typed parameters still error, so the migration looks "mostly done" while the silent cases hide.
- `@typescript-eslint/no-floating-promises` and `no-misused-promises` (with `checksConditionals`) catch many of these, but not a Promise stored in a `const` and later negated -- do not rely on lint alone.
- Grep every importer of the changed function and check each call before declaring the sync-to-async migration finished.
- Discovered during the TCG dashboard's `rules.sqlite` -> Postgres migration: `rules-ai.ts::findHallucinatedRules` would have reported zero hallucinated rule citations with a clean build.
