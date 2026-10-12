---
tech: typescript
tags: [javascript, date, iso-8601, parsing, validation, nodejs]
severity: high
---
# `new Date()` accepts 2026-02-30 and T24:00 and silently rolls them forward

## PROBLEM
The Date parser checks field ranges loosely. `new Date("2026-02-30T00:00:00Z")` is `2026-03-02T00:00:00.000Z` and `new Date("2026-03-01T24:00:00Z")` is the next day; neither is `Invalid Date`. An `isNaN(d.getTime())` check passes, so a mistyped expiry is stored as a different, valid-looking instant.

## WRONG
```ts
const at = new Date(value);
if (Number.isNaN(at.getTime())) throw new Error("not a date");
return at.toISOString(); // "2026-02-30T00:00:00Z" -> "2026-03-02T00:00:00.000Z"
```

## RIGHT
```ts
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// The date and time fields, read as UTC, must come back unchanged.
const wall = value.slice(0, 19);
const asUtc = new Date(`${wall}Z`);
const real = !Number.isNaN(asUtc.getTime()) && asUtc.toISOString().slice(0, 19) === wall;
if (!INSTANT.test(value) || !real) throw new Error(`${value} is not a real ISO-8601 instant`);
return new Date(value).toISOString();
```

## NOTES
- Round-trip only the wall-clock part, read as UTC: comparing the full value fails every legitimate offset like `+05:00`, because `toISOString()` prints Z.
- Date-only strings roll too: `new Date("2026-02-31")` is March 3.
- Related: `date-only-utc-off-by-one.md`. Verified on Node 24.21, 2026-10-12.
