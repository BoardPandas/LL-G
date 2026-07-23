---
tech: typescript
tags: [data-modeling, denormalization, cache-invalidation, nullish-coalescing, backfill, debugging]
severity: high
---
# Denormalized identity fields go stale on mutation; a precedence accessor and a "healing" read API hide it

## PROBLEM
When an entity's identity is stored in TWO places -- an authoritative denormalized field plus a nested transport/cache copy -- a mutation that updates one but not the other creates a silent inconsistency. It is brutal to debug because the usual tools give false confidence:

1. **Precedence accessor masks the fix.** If reads go through `authoritative ?? fallback`, "fixing" the fallback changes nothing a consumer sees -- the stale authoritative value still wins.
2. **A "healing" read projection hides the staleness.** A list/API endpoint that reports the *fallback* (fixed) field makes the record look fully repaired, while a different consumer reading the *authoritative* field still resolves the OLD entity. Verifying via the convenient API is misleading.
3. **Auditing the wrong field passes a broken record.** An audit keyed on a coincidentally-correct field (e.g. "does the image match the name?") misses a record whose identity is stale.
4. **Idempotent backfill can't repair stale-but-present values.** A script that skips rows where the ids are already populated only fills nulls; it never overwrites a wrong-but-present value.
5. **"Refresh only if invalid" gates skip stale-but-valid data.** A wrong-entity blob is still structurally valid, so a `hasBadData()` gate skips it. You need a targeted/force path.

Real case: proxy-deck card slots kept identity in `card.oracleId`/`card.scryfallId` AND `card.scryfall.oracleId`/`.scryfallId`. A card-swap updated the name + nested blob but not the top-level ids; `slotOracleId(card) = card.oracleId ?? card.scryfall?.oracleId` returned the OLD card. The printing picker showed the wrong card and confirm-print would have filed the wrong card into the collection. 144 slots across 12 decks were silently affected.

## WRONG
```ts
// Identity is denormalized; the read accessor prefers the top-level field.
function slotOracleId(card): string | null {
  return card.oracleId ?? card.scryfall?.oracleId ?? null; // top-level WINS
}

async function swapCard(card, newName) {
  card.originalName = newName;
  card.scryfall = await fetchScryfall(newName); // nested oracleId now correct...
  // ...but card.oracleId still points at the OLD card -> slotOracleId() is stale.
}

// "Repairs" that look like they work but don't:
//  - a refresh that only rewrites card.scryfall (the loser field)
//  - a list/MCP projection that REPORTS card.scryfall.oracleId (reads "fixed")
//  - an idempotent backfill that only fills nulls:
if (card.oracleId && card.scryfallId) continue; // never repairs a WRONG value
```

## RIGHT
```ts
// Re-sync EVERY denormalized copy from the source of truth in the SAME write,
// on any mutation that can change which entity the record represents. Only when
// the logical id actually changed, so benign edits keep intended conventions.
function syncSlotIdentityFromScryfall(card): boolean {
  const sfOracle = card.scryfall?.oracleId ?? null;
  if (sfOracle && card.oracleId !== sfOracle) {
    card.oracleId = sfOracle;
    if (card.scryfall?.scryfallId) card.scryfallId = card.scryfall.scryfallId;
    return true;
  }
  return false;
}

async function swapCard(card, newName) {
  card.originalName = newName;
  card.scryfall = await fetchScryfall(newName);
  syncSlotIdentityFromScryfall(card); // top-level id follows in the same write
}

// Repair keys on "value is WRONG", not "value is missing", and a trust-guard
// stops you syncing FROM an also-stale source:
for (const card of cards) {
  const sf = card.scryfall;
  if (sf?.oracleId && card.oracleId !== sf.oracleId
      && normalize(sf.name) === normalize(card.originalName)) { // trust guard
    card.oracleId = sf.oracleId;
    card.scryfallId = sf.scryfallId;
  }
}
```

## NOTES
Rule of thumb: any time you denormalize/cache an id in more than one place AND read it through `a ?? b`, EVERY writer that can change the entity must update `a` (the winner), and every repair/verify tool must target `a`, not the convenient one. When debugging, reproduce through the EXACT accessor the buggy consumer uses -- not the list/summary API, which may read the other field and lie. Related: [zod-object-strips-undeclared-keys.md] (persisted-vs-declared field drift) and [storage-helper-default-bucket-divergence.md] (writer/reader read different sources of the same value).
