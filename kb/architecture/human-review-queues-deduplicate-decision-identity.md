---
tech: architecture
tags: [review-queue, deduplication, idempotency, concurrency, postgres]
severity: high
---
# Human review queues must deduplicate by decision identity, not evidence row

## PROBLEM
A detector stores one row per observation, but several observations can represent the same human decision. For example, a location matcher evaluates both directions and writes A-to-B and B-to-A rows, then writes them again on the next sweep. The UI renders the evidence rows verbatim, so one decision appears many times and approving one row seems to do nothing when equivalent rows remain.

The inverse trap is treating a resolved row ID as permanent authorization to resolve that identity: if a later detector run creates genuinely new pending work with the same key, retrying the old request can silently resolve the new work.

## WRONG
```ts
for (const source of locations) {
  await db.insert(reviews).values({ sourceId: source.id, candidateId, status: "pending" });
}

// One evidence row, not one decision.
await db.update(reviews).set({ status: "approved" }).where(eq(reviews.id, reviewId));

// A stale resolved ID can mutate future pending work.
if (review.status === "approved") {
  await db.update(reviews).set({ status: "approved" }).where(samePendingIdentity(review));
}
```

## RIGHT
```ts
const [lowId, highId] = [sourceId, candidateId].sort();

// Back with a partial unique index on the canonical pending identity.
await db.insert(reviews).values(candidate).onConflictDoNothing();

if (review.status === "approved") {
  return { idempotent: true }; // Old request is a true no-op.
}
if (review.status !== "pending") throw new ConflictError();

// Resolve every evidence row for this currently pending decision atomically.
await tx.update(reviews).set({ status: "approved" }).where(
  and(eq(reviews.status, "pending"), unorderedPairEquals(lowId, highId)),
);
```

## NOTES
- Choose the identity at the human action boundary. Detector tier, confidence, source invoice, or direction may be provenance rather than identity.
- Preserve distinct evidence when it drives distinct mutations; two invoice lines that each need linking are two decisions even when their displayed address is identical.
- Clean existing duplicates before adding the unique index, retaining provenance by superseding rows rather than deleting them.
- When the decision mutates both members of an unordered pair, lock both rows in canonical order before validating either to prevent inverse concurrent actions from creating cycles.
