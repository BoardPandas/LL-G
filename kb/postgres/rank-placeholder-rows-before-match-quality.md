---
tech: postgres
tags: [order-by, distinct-on, ranking, lookup, placeholder-rows, fixtures, multi-pass, data-quality]
severity: high
---
# Rank real rows above placeholder rows BEFORE match quality, or a placeholder wins on a stronger match

## PROBLEM
A lookup that ranks candidates by match rule first (exact > prefix > alias) and by row
kind second (real record > placeholder/derived/printing-only row) returns a placeholder
whenever the placeholder matches by a stronger rule than the real row. The tiebreak
only works when both match the same way, which is exactly what hand-built fixtures
test. Real data holds the cross case.

Seen 2026-10-19 (tcg card lookup): "Insectile Aberration" is the BACK face of the real
card "Delver of Secrets // Insectile Aberration" and the FRONT face of an art-series
row "Insectile Aberration // Insectile Aberration". Front face outranked later face, so
the art card won. Fixtures with an art row sharing the real card's FRONT face passed.
Found only by the live check against production data.

Multi-pass lookups repeat the bug across passes: if pass 1 (cheap, indexed) settles a
name with a placeholder row, pass 2 (the rule that would find the real row) never runs.

## WRONG
```sql
SELECT DISTINCT ON (h.ord) h.*
  FROM hits h
 ORDER BY h.ord, h.match_rank,
          (h.layout <> ALL($2::text[])) DESC          -- real-row preference only breaks ties
```

## RIGHT
```sql
SELECT DISTINCT ON (h.ord) h.*
  FROM hits h
 ORDER BY h.ord,
          (h.layout IS NULL OR h.layout <> ALL($2::text[])) DESC,  -- real rows first
          h.match_rank
```
```ts
// multi-pass: a placeholder answer does not settle the name
const rest = names.filter((n) => { const hit = byName.get(n); return !hit || isPlaceholder(hit); });
// and only a real row may replace a placeholder from an earlier pass
```

## NOTES
Placeholders still answer when nothing real matches (a token name, say). Note the NULL
guard: `layout <> ALL(...)` is NULL for a NULL layout, and DESC sorts NULLS FIRST
(`order-by-desc-nulls-first.md`). Run any "done when" check against real data, not only
fixtures.
