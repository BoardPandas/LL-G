---
tech: typescript
tags: [drizzle, postgres, sql, any, array, in-array, 500, query-builder]
severity: high
---
# Drizzle `sql` template renders a JS array into `= ANY(...)` as invalid SQL

## PROBLEM
Interpolating a JavaScript array into a Drizzle `sql` tagged template for a Postgres `= ANY(...)` clause does not bind the array as a single array parameter. Drizzle expands a JS array inside a `sql` template into a comma-separated placeholder list (the form meant for an `IN (...)` list), so `= ANY(${jsArray})` becomes `= ANY(($1, $2))`. Postgres rejects that (`ANY` takes one array argument), the query throws at execution time, and the whole route 500s. It type-checks fine and looks correct, so the failure only shows up at runtime and is easy to misattribute to data/scope/permissions.

Real symptom: `/api/companies` 500'd on every `type` filter, so the Edit Service "Provider" dropdown showed "No results found" even though 292 provider rows existed.

## WRONG
```ts
import { sql } from "drizzle-orm";

const expanded = ["provider", "vendor"];
// Renders: lower("type") = ANY(($1, $2))  -> Postgres error -> 500
const cond = sql`lower(${companies.type}) = ANY(${expanded})`;
```

## RIGHT
```ts
import { inArray, sql } from "drizzle-orm";

const expanded = ["provider", "vendor"];
// inArray accepts a SQL expression on the left and renders:
//   lower("type") in ($1, $2)   -> valid
const cond = inArray(sql`lower(${companies.type})`, expanded);

// If you genuinely need ANY(array) (e.g. an array column), bind the array as a
// single param via sql.placeholder / a typed array value rather than letting
// the template expand it positionally.
```

## NOTES
- The expansion-into-placeholder-list behavior is the same mechanism Drizzle uses for `inArray`; the bug is only when you hand-write `ANY(${array})` expecting a single bound array.
- `inArray(column | SQL, values)` accepts a raw `sql` expression as its first argument, which is what lets you lowercase/cast the column inline.
- Empty arrays: guard `values.length > 0` before building the predicate (an empty `inArray` is also a footgun).
- Related: [SQL parameter index off-by-one in dynamic UPDATE builders](sql-parameter-index-off-by-one.md).
