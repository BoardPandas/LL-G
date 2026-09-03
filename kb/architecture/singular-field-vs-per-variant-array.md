---
tech: architecture
tags: [data-model, api-contract, silent-no-op, variants, multi-part-records, generated-content, write-path]
severity: high
---
# A singular field and its per-variant array both exist, and the writer silently picks the wrong one

## PROBLEM

A record type grows multi-part variants (a two-faced card, a multi-page document, a
multi-locale asset, an A/B pair) and the schema gains a per-part array alongside the
original singular field:

```
artPrompt:        string | null      // the original, used by single-part records
splitArtPrompts:  (string | null)[]  // one per part, used by multi-part records
```

The consumer branches on shape: if the record is multi-part it reads ONLY the array,
otherwise it reads only the singular field. That branch is correct. The failure is
that **the write path keeps accepting the singular field for every record**, so
setting it on a multi-part record is a well-formed, successful, completely inert
write.

Nothing surfaces it:

- the PATCH returns `200 {"success": true}` and the value is genuinely persisted
- the field is readable afterwards, so a round-trip check confirms your write
- the generator does not error, because the array had auto-derived defaults
  populated at import time, and it happily uses those
- the job reports `completed`, `failed: 0`

You get plausible output built from the DEFAULT input, which is far worse than an
empty result: an empty result is obviously wrong, whereas generic-but-valid output
looks like your content until someone reads it closely. In the case that produced
this entry, a themed card's art was generated from the generic text auto-derived
from the official card rather than from the authored themed prompt, and the giveaway
was subject matter that had nothing to do with the theme.

A second, compounding trap sits behind it: writing the per-part array does NOT reset
the per-part generation status. Each part is typically gated on
`status !== "pending"`, so a part that already generated from the default is skipped
forever on subsequent runs. The prompt is now correct, the output never changes, and
the run still reports success.

## WRONG

```ts
// Write path: accepts the singular field unconditionally.
if (body.artPrompt !== undefined) card.artPrompt = body.artPrompt;
if (body.splitArtPrompts !== undefined) card.splitArtPrompts = body.splitArtPrompts;
// No validation that artPrompt is meaningful for THIS record's shape,
// and setting splitArtPrompts does not touch splitArt[i].status.

// Caller, reasonably, sets the field it can see in the type:
await patch(`/cards/${i}`, { artPrompt: themedPrompt });   // 200 OK, inert
await post(`/art-gen/start`, { cardIndices: [i] });        // "completed, failed: 0"
// -> art generated from the auto-derived default, not from themedPrompt
```

## RIGHT

```ts
// 1. Make the inert write LOUD rather than silently accepted.
if (body.artPrompt !== undefined && hasMultipleParts(card)) {
  return c.json({
    error: "This record has parts; artPrompt is ignored. Use splitArtPrompts[].",
    field: "artPrompt",
  }, 400);
}

// 2. Changing an input must invalidate the output derived from it.
if (body.splitArtPrompts !== undefined) {
  body.splitArtPrompts.forEach((p, i) => {
    if (p !== card.splitArtPrompts?.[i] && card.splitArt?.[i]) {
      card.splitArt[i].status = "pending";   // else the part is skipped forever
      card.splitArt[i].error = null;
    }
  });
  card.splitArtPrompts = body.splitArtPrompts;
}

// 3. Caller: branch on the record's actual shape, never on the field you remember.
const body = hasMultipleParts(card)
  ? { splitArtPrompts: [promptForPartA, promptForPartB] }
  : { artPrompt: themedPrompt };
```

Verify by reading back the field the CONSUMER uses, not the one you wrote:

```bash
# Not "did my write persist" -- "is the input the generator will actually read set?"
jq '.cards[] | select(.index==54) | {artPrompt, splitArtPrompts}' manifest.json
```

## NOTES

- **The generic-default is what makes this HIGH.** If the per-part array were empty
  the run would fail loudly. Because import pre-populates it with defaults derived
  from the source record, the pipeline always has *something* to use, so the failure
  mode is confident wrong content rather than an error.
- **Auto-derived defaults deserve a provenance flag.** Store whether each part's
  input is `derived` or `authored`. Then "generate" can warn when it is about to
  spend real money rendering a derived default on a record whose singular field was
  authored, which is the exact contradiction that signals this bug.
- **Audit shape, not counts.** A coverage check like "100 of 100 records have
  artPrompt" reports green here: the field is set on every record, including the
  multi-part ones where it does nothing. Count per SHAPE -- every multi-part record
  must have a populated entry for every one of its parts.
- **Do not trust a directory listing mid-write.** Parts commonly write to
  sibling directories (`<id>-part0/`, `<id>-part1/`). Checking one path while the
  writer targets another, or listing during the run, produces a false "the file is
  missing" conclusion. Compare the manifest's recorded filenames against disk after
  the job reports done, and check every part's directory.
- Related: `derived-cache-currency-misses-second-input.md` (an input changes but the
  currency key does not notice) and `batch-op-keys-on-specific-status-field.md` (a
  batch gates on a status field, so a stale status silently skips real work). This
  entry is the write-side mirror of both: the input changed, and the status that
  gates the work was never invalidated.
