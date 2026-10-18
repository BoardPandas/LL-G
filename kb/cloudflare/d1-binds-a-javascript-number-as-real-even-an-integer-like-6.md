---
tech: cloudflare
tags: [d1, bind, real, integer, json-extract, cast, type-affinity]
severity: high
---
# D1 binds a JavaScript number as REAL, even an integer like 6

## PROBLEM
Cloudflare D1 binds every JavaScript `number` parameter as a SQLite REAL, whole numbers included: `.bind(6)` arrives as `6.0`. Comparisons and INTEGER-affinity columns hide it (`6.0 = 6` is true, and an INTEGER column stores 6), so most queries look right, and a REAL read back into JavaScript is just the number 6. It surfaces wherever SQLite uses the value's type:
- Text: `'$[' || ?1 || ']'` builds `$[6.0]`, and `json_extract` fails with `bad JSON path: '$[6.0]'`. Any key, path or label built by concatenation gets the `.0`.
- Arithmetic: `?1 / 2` with 7 bound is `3.5`, not SQLite's integer `3`.
- Storage: a column declared with no type keeps `7.0`.
- `min(col, ?1)`, `max` and `coalesce` return whichever operand wins, so the REAL appears only when the bound value wins. A query that works while a counter is below its cap breaks the first time the cap applies, long after the tests passed.

## WRONG
```ts
// Delay per attempt from a JSON array of cutoffs; ?2 is the cap.
db.prepare(
  "SELECT * FROM jobs WHERE due <= json_extract(?1, '$[' || min(attempts, ?2) || ']')",
).bind(JSON.stringify(cutoffs), 5);
// attempts below 5 builds '$[3]'; at the cap it builds '$[5.0]': D1_ERROR bad JSON path
```

## RIGHT
```ts
db.prepare(
  "SELECT * FROM jobs WHERE due <= json_extract(?1, '$[' || CAST(min(attempts, ?2) AS INTEGER) || ']')",
).bind(JSON.stringify(cutoffs), 5);
```
Cast a bound number with `CAST(... AS INTEGER)` wherever its type matters: concatenation, division (`CAST(?1 AS INTEGER) / 2`), JSON paths, and columns with no declared type.

## NOTES
- Reproduced with wrangler's local D1 (`getPlatformProxy`): `SELECT typeof(?1), ?1 || ''` bound to 6 returns `real` and `6.0`.
- A `BigInt` parameter is refused (`D1_TYPE_ERROR: Type 'bigint' not supported`), so there is no integer type to bind from JavaScript; cast in SQL.
- Test at the boundary where the bound value wins (`min`, `max`, `coalesce`), not only at typical values.
