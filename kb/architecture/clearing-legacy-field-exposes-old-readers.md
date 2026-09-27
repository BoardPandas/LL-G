---
tech: architecture
tags: [schema-migration, read-model, compatibility, legacy-field, per-variant-state, parity-test, silent-divergence]
severity: high
---
# Clearing a legacy field exposes readers that did not move to the canonical resolver

## PROBLEM

A record migrates one setting from a legacy top-level field to a more precise
per-variant map. The writer correctly saves the value under the active variant
and clears the legacy field so a future variant cannot inherit stale state. The
primary consumer also uses a canonical resolver that checks the variant map
first and falls back to the legacy field only for old records.

One secondary reader still reads the legacy field directly. Immediately after a
successful save, that reader sees `null` and presents the default value, while
the primary consumer uses the newly saved value. Reloading cannot help because
both views are reading the same valid record in different ways. The result looks
like a failed save or cache bug even though persistence and cache invalidation
are correct.

This is HIGH severity because every component can report success: the write is
durable, the derived output is correct, and only one editor or report silently
lies about the saved state. A round-trip test of the writer and an isolated test
of the primary consumer both stay green.

## WRONG

```js
// Writer migrates the active value and intentionally retires the fallback.
record.placements[activeVariant] = value;
record.legacyPlacement = null;

// The renderer uses the new representation.
render(resolvePlacement(record.art, record.legacyPlacement));

// A secondary editor still reads the retired representation directly.
editor.setPlacement(record.legacyPlacement ?? IDENTITY);
```

## RIGHT

```js
function resolvePlacement(art, legacyPlacement) {
  const name = approvedVariantName(art);
  const own = name ? art?.placements?.[name] : undefined;
  return own !== undefined ? own : (legacyPlacement ?? null);
}

// Every consumer asks the same question through the same resolver.
const placement = resolvePlacement(record.art, record.legacyPlacement);
render(placement);
editor.setPlacement(placement ?? IDENTITY);
```

When runtime boundaries prevent sharing the implementation, keep a small copy
and run the same table of legacy, migrated, missing-index, invalid-index, and
multi-variant inputs through both implementations in a parity test.

## NOTES

- Inventory every reader before the writer starts clearing the legacy field.
  Search for direct field access, not only imports of the old helper.
- Test the post-save record shape: new-map value present and legacy field null.
  Fixtures that populate both fields let an obsolete reader pass accidentally.
- Changing the selected variant must restore that variant's own value, while an
  old record with no map entry must still fall back to the legacy field.
- This is the read-side counterpart of
  `singular-field-vs-per-variant-array.md`, which covers a writer targeting the
  wrong representation for a multi-part record.
