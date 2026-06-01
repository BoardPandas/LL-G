---
tech: typescript
tags: [number, coercion, null, nan, sql-aggregate, silent-bug]
severity: high
---
# Number(null) === 0 silently turns a null/absent value into 0

## PROBLEM
`Number(null)` is `0` and `Number('')` is `0` (only `Number(undefined)` is `NaN`).
A "parse a number" helper that does `Number(n)` and then checks `Number.isFinite`
will accept `null`/`''` as a valid `0`. This is dangerous for nullable data such
as a SQL aggregate: a `SELECT avg(...)` over zero rows returns `null`, and a
`roundTo(avgFromDb)` helper coerces that `null` into `0` -- so the UI shows a
confident "0" (e.g. "average resolution time: 0m") instead of "no data". No error,
wrong output.

## WRONG
```typescript
function roundTo(n: unknown, dp = 1): number | null {
  const v = typeof n === 'number' ? n : Number(n); // Number(null) === 0
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 10 ** dp) / 10 ** dp;
}
roundTo(null); // => 0  (a null DB average becomes a real-looking 0)
```

## RIGHT
```typescript
function roundTo(n: unknown, dp = 1): number | null {
  if (n === null || n === undefined || n === '') return null; // guard first
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 10 ** dp) / 10 ** dp;
}
roundTo(null); // => null  ("no data")
```

## NOTES
Related to nullish.md (?? does not catch 0/''). Always guard null/undefined/''
BEFORE `Number()` when the source can be a nullable DB value. Booleans bite too:
`Number(false) === 0`, `Number(true) === 1`.
