---
tech: typescript
tags: [ranking, rating, elo, openskill, uncertainty, estimator, migration-default, silent-wrong-output]
severity: high
---
# Swapping a conservative rating display for a best estimate removes a hidden ranking guard

## PROBLEM
A displayed rating of `mu - 3*sigma` (openskill's "ordinal") does two jobs: it reads low for
uncertain entities, AND it silently keeps a maximum-uncertainty entity off the top of any ranking
sorted on it. Switch the display to a best estimate (`mu`, or `mu - 3*min(sigma, settled)`) and
the second job vanishes with nothing failing. A migration default of "every existing row counts
as settled/placed" assumes every stored rating is trustworthy; rows an operator had loosened to
maximum sigma were not. In production one such deck jumped from #8 (1872) to #1 (2136) with zero
confidence. No test caught it; a before/after diff of the prod table did.

## WRONG
```ts
// New display, plus "existing rows are placed" via a column DEFAULT.
export const displayElo = (r) => 1500 + (r.mu - 3 * Math.min(r.sigma, SETTLED_SIGMA)) * 16;
// ALTER TABLE ratings ADD COLUMN placement_pods INTEGER NOT NULL DEFAULT 10; -- all "placed"
```

## RIGHT
```ts
// Replace the guard explicitly: anything at maximum uncertainty is unranked/placing,
// in the backfill AND in every later path that can widen sigma (operator loosens).
// UPDATE ratings SET placement_pods = 0 WHERE sigma >= MODEL_SIGMA AND placement_pods >= 10;
if (confidence(next) === 0) resetPlacement(row); // inside the loosen UPDATE
```

## NOTES
- Before shipping an estimator change, list what the old number was protecting and move each
  job somewhere explicit. Then diff the ranked table before and after deploy on real data.
- "Existing" is not "settled": query the distribution (e.g. rows at the sigma cap) before
  choosing a backfill default.
- Related: number-null-coercion.md.
