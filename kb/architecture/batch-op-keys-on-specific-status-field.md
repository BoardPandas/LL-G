---
tech: architecture
tags: [status-fields, batch-operations, source-of-truth, idempotency, side-effects, art-gen]
severity: medium
---
# A batch operation keys on a specific status field -- not a sibling "done" flag

## PROBLEM
Entities often carry more than one status field describing different stages of a pipeline (e.g. `art.status` = "has the AI asset been generated" vs `render.status` = "has the frame been composited"). A batch/"process the missing ones" operation gates on ONE specific field. If you decide "this set has nothing to do" by reading a *sibling* field (or a rolled-up "X/X done" count), you can be wrong and silently trigger real, possibly paid, side-effecting work on every item.

The trap is that the sibling field reads as "done" while the field the operation actually checks reads as "pending", so a call you expected to be a no-op fans out to the whole collection.

## WRONG
```js
// Goal: pick a deck that won't trigger generation, to test a hand-off safely.
// Judged "no missing art" by render.status / the rendered count.
const rendered = cards.filter(c => c.render?.status === "rendered").length; // 10/10
// => assumed 0 missing, accepted the confirm...
// art-gen/start actually keys on art.status: "pending" counts as MISSING,
// so it began generating all 10 cards (paid image API) despite "10 rendered".
```

## RIGHT
```js
// Gate on the EXACT field the batch operation reads (here: art.status),
// not a sibling stage flag.
const missing = cards.filter(c =>
  !(c.useOfficialArt && c.officialArtUri) && c.art?.status !== "generated"
).length;
if (missing > 0) {
  // Real generation will fire -- confirm, budget, or pick a different deck.
}
// And when verifying any side-effecting batch hand-off, be ready to cancel:
//   POST /.../art-gen/cancel   (cooperative: finishes the in-flight item, then stops)
```

## NOTES
Concrete case: TCG proxy pipeline. `POST /api/proxy/decks/:slug/art-gen/start` with no body = "generate missing", and "missing" = any card whose `art.status !== "generated"`. A card can be `render.status: "rendered"` (frame composited from a placeholder) while `art.status: "pending"` (no AI art yet). Hit while live-verifying the AI Deck Builder transactional hand-off; the cancel endpoint is cooperative (the in-flight item completes before it stops).

General rule: before assuming a batch call is a no-op, read the source of the operation's own filter predicate and gate on that exact field. Related: source-of-truth drift -- don't infer one field's meaning from another's.
