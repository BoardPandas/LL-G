---
tech: nodejs
tags: [concurrency, batch, preflight, paid-actions, validation]
severity: high
---
# Per-item preflight does not protect a concurrent paid batch

## PROBLEM

A validation placed immediately before each paid or irreversible call looks like a complete
preflight, but it protects only that item. With concurrent callbacks, an early item can finish
validation and start the paid call while a later item is still loading the bytes or state it must
validate. Sequential front/back/split passes have the same bug across passes: every front can spend
before a later back discovers drift.

This is especially easy to miss when single-item tests prove that a mismatch reaches zero provider
calls. Those tests say nothing about a batch whose first item is valid and whose second or later-pass
item is stale. The system reports the mismatch correctly, but only after money or another
irreversible side effect has already occurred.

## WRONG

```ts
await mapWithConcurrency(targets, 12, async (target) => {
  const actual = await loadActualInputs(target);
  assertReviewedInputs(target, actual);
  await paidProviderCall(actual);
});
```

## RIGHT

```ts
// Cover every target across every later execution pass before any spend.
await Promise.all(
  allBatchTargets.map(async (target) => {
    const actual = await loadActualInputs(target);
    assertReviewedInputs(target, actual);
  }),
);

await mapWithConcurrency(targets, 12, async (target) => {
  const actual = await loadActualInputs(target);
  assertReviewedInputs(target, actual); // defense in depth against post-preflight drift
  await paidProviderCall(actual);
});
```

## NOTES

The up-front phase must validate the actual dispatch inputs, including bytes loaded from a path;
metadata or path equality alone does not cover same-path content replacement. Test at least two
targets with drift on the later target and one valid early-pass target followed by drift in a later
pass. Both cases must assert zero paid calls for the whole batch.
