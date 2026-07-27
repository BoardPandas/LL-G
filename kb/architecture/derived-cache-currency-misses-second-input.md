---
tech: architecture
tags: [caching, invalidation, derived-data, staleness, fingerprint, etl, scoring]
severity: high
---
# A derived cache's currency key must cover EVERY input, not just the obvious one

## PROBLEM

Derived-value caches (a computed score, a rendered artifact, an enrichment blob)
usually decide "is this row still valid?" from a fingerprint of the *primary*
input — the document, the row, the file the value is "about". That works right
up until the computation grows a SECOND input. From then on the cache is
confidently wrong: the second input changes, the fingerprint does not move, the
row reads as current forever, and nothing errors.

This fails silently in the worst possible way. There is no exception, no failed
health check, no log line. Tests pass, because tests compute fresh values and
never exercise the stale path. The deploy is green. The only symptom is that a
number stops tracking reality — and a plausible-looking stale number is
indistinguishable from a correct one.

**The tell is a mismatch between what the computation READS and what the
currency key COVERS.** Any time you add a new read to a cached computation —
a new column, a joined table, a config value, a corpus — ask immediately: *if
only that changes, does anything recompute?* If the answer is no, you have just
built a silent freeze.

One feature hit this three times in a day, each time with a different second
input, which is what makes it worth generalizing rather than treating as a bug:

1. **A new field became an input.** A score started reading the document's
   `tags`. The fingerprint hashed cards + commander. Retagging changed nothing.
2. **An external corpus became an input.** The score was measured against a
   crawled reference set. The fingerprint is document-derived by construction,
   so a crawl landing 400k new rows invalidated nothing — the whole library
   froze on pre-crawl values, and a *manual* version bump was needed to unstick
   it. A weekly crawl would have needed one every week.
3. **The invalidation itself was coupled to the cache.** The "which reference
   data do we want?" registration lived *inside* the scoring function. So
   widening what to fetch registered nothing, because nothing needed rescoring,
   because no new data had landed. A deadlock in which both halves waited on the
   other, and the queue just sat at its old size after a green deploy.

## WRONG

```ts
// Currency = deck hash + fingerprint + scorer version. All document-derived.
function fingerprint(doc: Doc): string {
  return sha256(JSON.stringify({ commander: doc.commander, cards: doc.cards }));
}

async function score(doc: Doc) {
  const consensus = await db.query("SELECT ... FROM external_corpus WHERE ...");
  //                      ^^^^^^^^ a SECOND input the fingerprint cannot see
  return computeScore(doc, consensus, doc.tags);
  //                       ^^^^^^^^^  ^^^^^^^^^ ...and a THIRD
}

// ...and the request for new corpus data lives inside the thing it feeds:
async function scoreBatch(docs: Doc[]) {
  await enqueueWantedCorpusRows(docs);   // only runs while rescoring
  ...
}
// Widen what you want -> nothing is enqueued (nothing needs rescoring)
// -> no new data lands -> nothing needs rescoring. Deadlock, silent, green.
```

## RIGHT

```ts
// 1. Document-derived inputs go IN the fingerprint. Sort/dedupe so cosmetic
//    reordering doesn't force pointless recomputes.
function fingerprint(doc: Doc): string {
  const tags = [...new Set((doc.tags ?? []).filter(Boolean))].sort();
  return sha256(JSON.stringify({ commander: doc.commander, cards: doc.cards, tags }));
}

// 2. NON-document inputs often CANNOT go in the fingerprint -- here it is also
//    computed synchronously around writes, so it can take no async/DB input.
//    Compare the payload's computedAt against the input's own timestamp instead.
//    One scalar query per sweep beats a per-row lookup.
const corpusStamp = await db.oneValue("SELECT max(fetched_at) FROM external_corpus");

function isCurrent(row: CachedRow): boolean {
  return (
    row.fingerprint === fingerprint(doc) &&
    row.version === SCORER_VERSION &&
    !payloadPredatesInput(row, corpusStamp)
  );
}

function payloadPredatesInput(row: CachedRow, stamp: Date | null): boolean {
  // A missing stamp means "no reason to invalidate" -- NEVER "invalidate all".
  if (!stamp || !row.computedAt) return false;
  return Date.parse(row.computedAt) < stamp.getTime();
}

// 3. The reuse path needs the SAME check. A stale payload handed out by a
//    "another row already computed this fingerprint" shortcut resurrects
//    exactly what the check above just rejected.
if (row.version === SCORER_VERSION && !payloadPredatesInput(row, corpusStamp)) {
  reusable.set(row.fingerprint, row.payload);
}

// 4. Registering WHICH external data you want is bookkeeping, not scoring.
//    Run it on the reconciliation sweep that sees every document anyway, so it
//    fires whether or not anything needs recomputing.
if (discovered.keys.length > 0) await enqueueWantedCorpusRows(discovered.keys);
```

## NOTES

- **Bumping the version constant is a symptom, not a cure.** It unsticks the
  cache once. If the second input refreshes on a schedule, you have signed up
  for a manual bump every cycle — and the day someone forgets, the numbers
  quietly go stale again. Fix the currency check; keep the bump for genuine
  changes in what a value MEANS.
- **Verify against production DATA, not the deploy.** All three instances passed
  CI, deployed green, and returned HTTP 200. Each was caught only by reading an
  actual stored value and noticing it hadn't moved. A green pipeline says the
  code shipped; it says nothing about whether the cache noticed.
- **"Nothing changed after my fix" is the signature, not a null result.** The
  third instance announced itself as a queue count that stayed identical after a
  successful deploy. Treat an unchanged number following a change that should
  have moved it as a finding, never as "it must not have run yet".
- **Watch for the mirrored asymmetry.** The same feature also filtered a
  category (basic lands, print-only tokens) from one side of a comparison but
  not the other, so those items surfaced as "missing" or "unrecognized" on every
  single row. Whenever you exclude a class of thing, grep for every other place
  the same set is built and exclude it there too.
- Related: `derived-signal-goes-constant.md` (a derived value silently going
  constant because its SOURCE stopped varying) is the same family seen from the
  other end — there the input changed shape, here the input changed value and
  nobody was watching.
