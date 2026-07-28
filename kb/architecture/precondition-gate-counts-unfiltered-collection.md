---
tech: architecture
tags: [preconditions, invariants, filtering, shared-predicate, retry-loop, error-messages, background-jobs]
severity: high
---
# A precondition gate must count what the consumer will actually process

## PROBLEM

A guard answers "is there anything to do here?" by measuring the raw input --
`items.length`, `rows.length`, a `COUNT(*)` -- while the consumer filters that
same collection before working on it. The two disagree for exactly one input
shape: a collection made ENTIRELY of items the consumer drops. The gate says
"non-empty, proceed"; the consumer sees nothing and fails.

Three things make it expensive to debug:

1. **The error message points away from the cause.** The consumer reports its
   generic "no usable input" failure, which was written for a DIFFERENT
   situation (data missing or not yet fetched). So the message says something is
   missing about an input where nothing is missing.
2. **The gate was correct when it was written.** It only becomes wrong the day
   someone adds a filter to the consumer, and only for the all-filtered edge
   case, which may not exist in the data until much later.
3. **A retryable failure never settles.** If the failure is persisted as a
   "failed" state, a reconciler treats it as not-current and requeues it on
   every pass -- forever, at whatever the sweep interval is.

Concrete case: a deck-profile scorer started excluding print-only "extra" cards
(tokens) from every scoring axis. Four separate call sites gated on
`manifest.cards.length`. A token-only deck -- 196 cards, every one an extra --
passed all four, prepared zero cards, and reported "No cached Oracle card data
is available for scoring" for a deck whose data was completely intact. Being
`failed`, it was retried every 15 minutes indefinitely (`attempt_count` climbing
in prod) until the gate was corrected.

## WRONG

```ts
// GATE -- counts raw slots.
if (manifest.cards.length === 0) {
  await deleteProfileState(slug); // "empty, nothing to do"
  return;
}
await queueScoring(slug); // 196 tokens look like a full deck here

// CONSUMER -- filters FIRST, then measures.
function prepareDeck(manifest: Manifest): Prepared | null {
  const cards: SlimCard[] = [];
  for (const card of manifest.cards) {
    if (isExtraCard(card)) continue; // the gate cannot see this
    cards.push(slim(card));
  }
  // Reached with zero cards. The message describes a cause that is not this one.
  if (cards.length === 0) return null; // -> "No cached card data is available"
  return { cards };
}
```

## RIGHT

```ts
// ONE exported predicate that counts what the consumer will ACTUALLY see.
export function hasScoreableCards(cards: unknown): boolean {
  return Array.isArray(cards) && cards.some((c) => !isExtraCard(c));
}

// Every gate calls it. There were FOUR here (reconciler, mutation hook, list
// route, detail card) and they must not be able to disagree.
if (!hasScoreableCards(manifest.cards)) {
  await deleteProfileState(slug); // unscoreable, exactly like empty
  return;
}
await queueScoring(slug);

// The consumer KEEPS its null return -- it still catches the genuine case the
// error message was written for: real items present, but their data is missing.
```

## NOTES

- **Trigger to look for this:** any commit that adds a filter, skip, or
  `continue` to a consumer. In the same change, grep every `.length` /
  `COUNT(*)` gate over that same collection. Each one was correct before the
  filter existed and is silently wrong after.
- **The retry loop is the severity multiplier, not the failure itself.** A
  wrong-but-terminal error is a bug; a wrong error that a reconciler retries
  forever is a bug plus permanent noise plus wasted work. Distinguish "can never
  succeed" (delete the row / mark unscoreable) from "failed, worth retrying" --
  they are different outcomes and must not share a state.
- **UI gates need the same predicate.** A read path that renders the gate's
  answer will otherwise show a "loading / updating" state that never resolves,
  because the thing it is waiting for will never be produced. Two of the four
  call sites here were read paths.
- **Do not fix this by loosening the consumer.** Making the consumer tolerate
  zero items hides the real signal (genuinely missing data) behind a success.
  Fix the gate; leave the consumer strict.
- Sibling entry: [A batch operation keys on a specific status field](batch-op-keys-on-specific-status-field.md)
  -- same family, a gate reading a proxy for the real condition rather than the
  condition itself.
