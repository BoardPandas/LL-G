---
tech: typescript
tags: [date, timezone, postgres, date-only, toLocaleDateString, rendering, testing, silent-wrong-output]
severity: high
---
# `new Date('2026-03-15')` is UTC midnight, so a DATE column renders a day early west of Greenwich

## PROBLEM

A Postgres `DATE` is a calendar day, not an instant. Serialised it is a bare
`"YYYY-MM-DD"`, and `new Date("2026-03-15")` parses a *date-only* ISO string as
**UTC midnight** — this is specified behaviour, and it differs from
`new Date("2026-03-15T00:00:00")` (no `Z`), which parses as *local* midnight.

Format that UTC instant with `toLocaleDateString()` and it is rendered in the
viewer's zone. Anywhere west of Greenwich, UTC midnight is the previous evening,
so **every date displays one day early**. In `America/New_York` a deal closing on
the 15th reads "Mar 14, 2026"; in `Asia/Tokyo` it reads correctly. The value in
the database is right, the API response is right, and the screen is wrong.

Three things make it survive review:

- **It is invisible in UTC.** CI containers, most Docker images and most CI
  runners default to UTC, where the naive code is correct. A full green suite is
  not evidence.
- **It looks like the careful path.** Server code often goes out of its way to
  emit a bare day (`to_char(col, 'YYYY-MM-DD')`, or a driver configured not to
  build a `Date`), and that care is then undone one layer later by a formatter
  nobody thinks of as a parser.
- **Off-by-one dates read as plausible.** Nobody reports "the close date is
  wrong"; they quietly work from it.

The same trap applies to any date-only value: birthdays, invoice dates, due
dates, `expires_on`. It does **not** apply to `timestamptz`, which is a genuine
instant and *should* be localised.

## WRONG

```ts
// API returns close_date: "2026-03-15" from a Postgres DATE column.
export function formatCloseDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
// TZ=UTC              -> "Mar 15, 2026"   (passes review, passes CI)
// TZ=America/New_York -> "Mar 14, 2026"   (what every US user sees)

// And a test that proves nothing, because the runner is UTC:
it('renders the close date', () => {
  expect(formatCloseDate('2026-03-15')).toBe('Mar 15, 2026')
})
```

## RIGHT

```ts
// A date-only value has no zone, so render it in the one it was parsed in.
export function formatCloseDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',        // <- the whole fix
  })
}

// Or never involve UTC at all: build a local date from the parts.
export function formatCloseDateLocal(value: string): string {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
```

```ts
// Pin it under a zone that would expose the regression. A test in UTC passes
// against the broken version and is worse than no test, because it looks like
// coverage.
describe('formatCloseDate', () => {
  const original = process.env.TZ
  beforeAll(() => { process.env.TZ = 'America/New_York' })
  afterAll(() => { process.env.TZ = original })

  it('renders the stored calendar day, not the day before it', () => {
    expect(formatCloseDate('2026-03-15')).toBe('Mar 15, 2026')
  })

  it('survives the day the clocks go forward', () => {
    expect(formatCloseDate('2026-03-08')).toBe('Mar 8, 2026')
  })
})
```

## NOTES

- Setting `process.env.TZ` inside a test file only works if it happens before
  the first `Date` is constructed in that worker. Jest respects it in
  `beforeAll` for these formatting calls; for anything that caches a formatter
  at module scope, set `TZ` in the jest config or the runner's environment
  instead.
- Better still, make the whole suite run somewhere awkward: `TZ=America/New_York`
  (a DST zone with a negative offset) catches this class where UTC never will.
  `Pacific/Kiritimati` (+14) catches the mirror-image bug where a local parse is
  formatted as UTC.
- `Intl.DateTimeFormat` takes the same `timeZone` option and has the same
  default, so it is the identical trap.
- Storing a date-only value in a `timestamptz` column moves the bug to the
  database and makes it worse, because the shift then depends on the writing
  connection's `TimeZone`. If it is a calendar day, keep it a `DATE`.
- Discovered in production: caught by an adversarial code review rather than by
  any test, typecheck or lint, on a codebase where 3,400 tests were green.
