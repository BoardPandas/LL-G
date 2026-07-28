---
tech: typescript
tags: [third-party-api, data-modeling, variant-types, discriminated-union, debugging, diagnosis, scryfall]
severity: high
---
# An unmodeled API variant looks exactly like corrupted data

## PROBLEM

Third-party records are usually a **tagged union wearing one TypeScript type**. A `layout` / `kind` / `type` field selects which *other* fields are populated, and the same logical content lives in a different field per variant.

A reader that knows only one variant returns `null` for every other variant. That `null` is indistinguishable from genuinely missing data — and the failure is worse than a plain bug, because it inverts the diagnosis:

1. The UI renders the content correctly (the renderer handles all variants).
2. Your reader returns `null` for it.
3. You conclude **the stored data is corrupt**, because the screen proves the content exists.
4. You go "fix" a normalizer, schema, or cache that was correct the whole time.

The tell that you are in this trap: *a rendered output you cannot explain from your data model*. That is evidence your model is incomplete, not that the data is broken. Same for display names — a record can carry an alternate printed label (`flavor_name`, `display_name`, `alias`) that is a legitimate upstream variant, not a user customization.

Concrete instance: Scryfall cards. A card's second half lives in `card_faces` for `transform` / `modal_dfc` layouts, but a `split` / `adventure` / `prepare` layout prints **both halves on one physical face**, so `back` is legitimately `null` and the other half lives in a sibling field. A reader checking only `back` reports "missing back face" on a perfectly healthy record.

## WRONG

```ts
// Reader knows exactly one variant.
function secondHalf(card: ScryfallData): string | null {
  return card.back?.oracleText ?? null;
}

// "Emeritus of Ideation // Ancestral Recall" -> layout: "prepare"
//   name:     "Emeritus of Ideation // Ancestral Recall"   <- both halves
//   typeLine: "Creature — Human Wizard // Instant"          <- both halves
//   back:     null                                          <- CORRECT: single-faced
//   spellFaces: [{ name: "Ancestral Recall", oracleText: "Target player draws three cards." }]
//
// secondHalf() -> null. The UI renders Ancestral Recall in a side panel.
// Conclusion drawn: "the cached snapshot is missing the back face."
// Actual state: data complete, reader incomplete.
// Near-miss: almost widened a DFC_LAYOUTS allowlist that correctly
// excluded "prepare" -- which would have invented a back face that
// does not physically exist and broken every real DFC renderer.
```

## RIGHT

```ts
// Branch on the discriminant, then read the field THAT variant uses.
function secondHalf(card: ScryfallData): string | null {
  if (isDoubleFaced(card.layout)) {
    // transform | modal_dfc | meld | reversible_card | double_faced_token
    return card.back?.oracleText ?? null;
  }
  // split | aftermath | adventure | prepare: both halves, one physical face
  const faces = card.spellFaces ?? [];
  return faces.length ? faces.map((f) => f.oracleText).join("\n") : null;
}
```

Before filing "the data is corrupt", make the null prove itself:

```ts
// A null that has not been explained is a hypothesis, not a finding.
function explainMissing(card: ScryfallData) {
  return {
    layout: card.layout,                       // which variant IS this?
    expectedField: isDoubleFaced(card.layout)
      ? "back"
      : "spellFaces",                          // where SHOULD it live?
    backPresent: card.back !== null,
    spellFacesPresent: (card.spellFaces?.length ?? 0) > 0,
  };
}
// Only when the field that THIS variant is supposed to populate is empty
// do you have a data defect.
```

## NOTES

The guard, stated generally: **when a rendered or derived output shows something your data model does not account for, identify the record's variant discriminant before concluding the data is broken.** The renderer already handles every variant — that is precisely why it can display what your reader cannot find.

Two failures of this shape landed in a single session, both on correct data:

- **Alternate printed name read as user customization.** A card displayed as "Heart of the Explorer" above "Search for Azcanta" was assumed to be a user-authored reskin, so the whole deck was misclassified as customized. It was an official Secret Lair printing carrying an upstream `flavor_name`; every custom-name field in the record was `null`. Check the printing's set and `flavor_name` before attributing a label to a user.
- **Single-faced layout read as a missing back face.** Described above.

Both wasted time in the same direction: toward "repair the data" and away from "read the schema". Cheap discriminators, in order:

1. Print the discriminant (`layout`, `set`, `flavor_name`) for the specific record — one call, ends the argument.
2. Ask whether the *renderer* has code for this case. If the UI displays it, the data is present somewhere; find where before touching a normalizer.
3. Ask what field this variant is *supposed* to populate. `null` in a field that this variant never populates is not a defect.

Cross-reference: this is the read-side twin of [zod-object-strips-undeclared-keys](zod-object-strips-undeclared-keys.md) and [zod-validation-at-persisted-data-boundary](zod-validation-at-persisted-data-boundary.md) — there an under-declared schema silently *destroys* variant data on write; here an under-declared reader silently *fails to find* it on read, then blames the store.
