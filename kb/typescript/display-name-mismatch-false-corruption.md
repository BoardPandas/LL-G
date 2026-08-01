---
tech: typescript
tags: [api-integration, data-integrity, caching, identifiers, false-positive, destructive-repair]
severity: high
---
# Comparing display names instead of stable ids reports valid records as corrupt

## PROBLEM

You cache a third-party record alongside the name you looked it up by, then write
an integrity check: "if the stored name and the cached record's name disagree,
the cache is stale." That check is wrong, because many APIs legitimately expose
MORE THAN ONE display name for the same entity -- an alternate/localized/branded
label that resolves to the identical underlying record.

Scryfall is the concrete case: a Universes Beyond printing carries a
`flavor_name` alongside its canonical `name`, and `/cards/named?exact=` resolves
the flavor name to the underlying card. A slot storing
`"Master Weaver, Web Protector"` whose cached blob says
`"Arasta of the Endless Web"` is not corrupt -- both name the same card, and the
`oracle_id` is identical.

The trap has three teeth:

1. **The false positive looks like a real bug.** Two different strings for what
   should be one card reads as obvious cache drift.
2. **Acting on it is DESTRUCTIVE, not merely wrong.** The "repair" re-resolves
   the record and overwrites a correct one. Unlike most false positives, this one
   does damage when you believe it.
3. **The genuine failures point in BOTH directions**, so you cannot pick a
   winner by rule. In the same corpus, one slot's stored name was right and the
   cached blob was stale; another slot's cached blob was right and the stored
   name was wrong (it named a real but structurally invalid record). A repair
   that always trusts the stored name corrupts the second class.

Measured over 158 real records: 5 name mismatches, only 2 genuine. A
name-string detector was 60% false positives, and every false positive was an
instruction to destroy good data.

## WRONG

```ts
// "The names disagree, so the cache must be stale." Then re-resolve by name.
const stale = card.originalName !== card.scryfall?.name;
if (stale) {
  const fresh = await searchCard(card.originalName); // may be a DIFFERENT entity
  card.scryfall = toScryfallData(fresh);             // overwrites a correct blob
}
```

Two ways this loses data: a flavor-name record is "repaired" into an identical
blob it never needed, and a record whose stored NAME is the wrong half gets the
cache rewritten to match the bad name instead of the good cache.

## RIGHT

```ts
// Compare the STABLE IDENTIFIER, never the human-readable label.
const resolved = await searchCard(card.originalName);
const storedId = card.scryfall?.oracleId ?? null;
const resolvedId = resolved?.oracle_id ?? null;

// Same id  -> alternate/flavor name or orthography drift. NOT a defect.
// Differing -> a genuine mismatch, but you still do not know WHICH side is wrong.
if (storedId && resolvedId && storedId !== resolvedId) {
  report({ index: card.index, storedName: card.originalName,
           cachedName: card.scryfall?.name, storedId, resolvedId });
  // Decide per record; do not auto-repair. Validate the candidate first:
  // here, one "mismatch" resolved to a Planechase plane -- a real card, but
  // illegal in the deck. Auto-repairing would have replaced a legal land.
}
```

Normalize before any string comparison you still need (NFC + collapse
whitespace + case-fold); accents and casing produce their own false positives
(`AEtherize` vs `Aetherize`).

## NOTES

- Sibling entry: `unmodeled-api-variant-looks-like-corrupt-data.md`. Same
  conclusion ("the data is corrupt") reached by a different route: that one is a
  READER blind to a tagged-union variant, this one is a DETECTOR comparing labels
  instead of ids. Read both before declaring third-party data defective.
- **Fixing a name can silently repoint other fields.** In the same codebase, a
  bare name PATCH re-fetched by the new name and overwrote the record's pinned
  printing/art URI, discarding a deliberately-chosen variant. Correct the name
  first, then re-pin the variant explicitly, and re-read the whole record
  afterward -- not just the field you set.
- Report a mismatch; do not auto-repair. There is no rule for which side is
  authoritative, and the wrong guess overwrites the good half.
- Verify a detector by its FALSE-POSITIVE rate on real data before wiring it to
  a mutation. Running it read-only over the full corpus first is what exposed
  that 3 of 5 hits were benign.
