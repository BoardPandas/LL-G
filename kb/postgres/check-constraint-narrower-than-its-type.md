---
tech: postgres
tags: [schema, check-constraint, varchar, enum, migrations, testing, fakes]
severity: high
---
# A CHECK constraint or VARCHAR width narrower than the type it stores fails only against a real database

## PROBLEM

An enum lives in two places: the application type (a Zod enum, a TS union, a Go
const block) and the column that stores it (`VARCHAR(n)` + `CHECK (col IN (...))`).
They are written at different times by different people and drift apart silently.

Nothing catches the drift:

- **The typechecker cannot see SQL.** `tsc` is clean; the CHECK list is a string.
- **Unit tests cannot see the column.** Suites that run against a fake DB, an
  in-memory stub, or a mocked query layer have no column widths and no CHECK
  constraints. Every value passes.
- **The narrow value is usually the rare one.** `unknown`, `degraded`,
  `unavailable`, `domain_controller` — the states that fire when something has
  gone wrong, or on the minority of the fleet. Ordinary fixtures never produce
  them, so coverage looks total.

It surfaces as a `23514 check_violation` or `22001 value too long` on real data,
long after the tests went green, and only for the rows that mattered most.

Two distinct failures hide here, and the second is easy to miss:

1. **The CHECK omits a value the type permits.** Adding a member to the
   application enum does not touch the migration.
2. **The column is too narrow for the longest permitted value.** `VARCHAR(16)`
   with `'domain_controller'` (17 chars) is rejected outright — Postgres raises
   `value too long`, it does not truncate.

A real instance: `product_type VARCHAR(16) CHECK (product_type IN
('workstation','server','domain_controller','unknown'))`. The CHECK lists a
value the column cannot physically hold. Every domain controller in the fleet
would have failed to store its own type — the one device class the column
existed to distinguish — while five unit tests asserting that exact distinction
passed, because they ran against a fake.

## WRONG

```sql
-- Written when the type had three values and the longest was 8 characters.
-- The type has since gained 'degraded' and 'unavailable'.
scan_status VARCHAR(8) NOT NULL DEFAULT 'unknown' CHECK (
  scan_status IN ('ok', 'unknown', 'error')
),

-- CHECK permits a 17-character value the column cannot hold.
product_type VARCHAR(16) NOT NULL CHECK (
  product_type IN ('workstation', 'server', 'domain_controller', 'unknown')
),
```

```ts
// The application type, drifting independently.
export const ScanStatusSchema = z.enum(['ok', 'degraded', 'unavailable', 'unknown']);
//                                            ^^^^^^^^^^  ^^^^^^^^^^^^^ neither is storable
```

## RIGHT

```sql
-- Every value the type permits, in a column wide enough for the longest.
-- The comment names the type so the next reader knows what to diff against.
scan_status VARCHAR(16) NOT NULL DEFAULT 'unknown' CHECK (
  scan_status IN ('ok', 'degraded', 'unavailable', 'unknown')
),

product_type VARCHAR(24) NOT NULL CHECK (
  product_type IN ('workstation', 'server', 'domain_controller', 'unknown')
),
```

Audit every enum column mechanically rather than by eye — this finds the width
bug, which reading the CHECK list will not:

```python
import re
for m in re.finditer(r"(\w+)\s+VARCHAR\((\d+)\)[^;]*?CHECK\s*\(\s*\1\s+IN\s*\(([^)]*)\)", sql, re.S):
    col, width = m.group(1), int(m.group(2))
    values = re.findall(r"'([^']*)'", m.group(3))
    longest = max(values, key=len)
    if len(longest) > width:
        print(f"OVERFLOW {col} VARCHAR({width}) cannot hold '{longest}' ({len(longest)})")
```

## NOTES

- **A CHECK wider than the type is safe; narrower is the bug.** When in doubt,
  widen. A permitted value nothing writes costs nothing; a written value nothing
  permits is an outage.
- Prefer `TEXT` + CHECK over `VARCHAR(n)` + CHECK unless the width is a real
  constraint. It removes the overflow failure mode entirely and Postgres stores
  them identically.
- **A test suite that runs against a fake DB proves nothing about the schema.**
  Its passing is not evidence the column accepts what the code sends. Apply
  migrations to a scratch database and round-trip one row per enum value, or
  accept that this class of bug ships.
- The values most likely to be missing are the honest-failure states — `unknown`,
  `degraded`, `unavailable`. If a codebase has a house rule to report `unknown`
  rather than `ok` when something could not be evaluated, the schema is where
  that rule gets quietly reversed: a device that could not be scanned fails to
  record that it could not be scanned, and keeps whatever status it had before.
- Related: `nullable-column-in-composite-unique-key.md` — the other way a schema
  silently disagrees with the intent of the code writing to it.
