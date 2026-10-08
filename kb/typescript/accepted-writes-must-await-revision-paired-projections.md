---
tech: typescript
tags: [async, revision, ui-state, exact-once, retries]
severity: high
---
# Accepted writes must await revision-paired projections

## PROBLEM

An authoritative write can resolve and publish a new revision before an asynchronous derived view
for that revision has loaded. If the interaction reports `idle` at write completion, the old view
may be repainted against the new revision and a later forced refresh can overlap the next gesture.
The UI looks settled while expensive or state-changing work is still running.

There is a second exact-once trap: putting the accepted write and its projection refresh in the same
`try`/`catch` turns a projection failure into a retryable write failure. Retrying then submits an
operation the server already accepted.

## WRONG

```typescript
try {
  const result = await store.apply(ops);
  await loadProjection(store.get());
  return result;
} catch (error) {
  return offerWriteRetry(error);
}
```

## RIGHT

```typescript
const result = await applyAuthoritativeWrite(ops); // write failures are classified here

if (result.ok !== false) {
  try {
    await loadAndPaintExactProjection(result.rev);
  } catch (error) {
    reportProjectionFailure(error); // never makes the accepted write retryable
  }
}

return result;
```

Retain the last exact revision-paired DOM while the projection loads, gate new commits while no
exact pair exists, and use keyed reconciliation when the pair arrives instead of painting an empty
or mismatched intermediate state.

## NOTES

Pin this with three tests: defer the projection and prove interaction settlement waits; reject the
projection and prove no write retry is offered; advance the revision and prove unchanged DOM remains
intact until the exact pair is accepted. End-to-end latency should also verify that background
refresh work cannot spill into the next gesture.
