---
tech: typescript
tags: [sort, comparator, null, NaN, ranking, ui]
severity: high
---
# Sorting by a nullable rank (a.rank - b.rank) silently scrambles the order

## PROBLEM
Once a field like `rank` can be null (an unranked entity kept in the list), `a.rank - b.rank`
yields `NaN` for any pair involving it. `Array.prototype.sort` treats an inconsistent comparator
as implementation-defined, so order is left to the engine: no error, a plausibly wrong list.
Row keys built from the same field (`#${d.rank}`) also collide as `#null`.

## WRONG
```js
decks.sort((a, b) => a.rank - b.rank); // rank is null for unranked rows
const key = (d) => d.deckSlug ?? `#${d.rank}`;
```

## RIGHT
```js
// Send a separate, always-present list position and order on that.
const order = (d) => (Number.isFinite(d.position) ? d.position : Number.isFinite(d.rank) ? d.rank : 0);
decks.sort((a, b) => order(a) - order(b));
const key = (d) => d.deckSlug ?? `#${order(d)}`;
```

## NOTES
- Guard display too: a formatter doing `Number(v).toFixed()` prints "0" for null
  (see number-null-coercion.md), so an unranked row shows as rank 0.
