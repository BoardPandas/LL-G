---
tech: typescript
tags: [sql, postgres, query-builder, dynamic-where, filters, silent-empty-result]
severity: medium
---
# Default WHERE exclusion silently contradicts a user-supplied condition

## PROBLEM
A shared list query builder that always appends an implicit "sensible default"
filter (hide closed, hide soft-deleted, only-open) silently contradicts any
user-authored condition over the same column. When a saved-view / advanced-filter
feature compiles user conditions into their own WHERE fragment, a condition like
"Status is Closed" gets AND-ed with the builder's hardcoded
`AND LOWER(t.status) != 'closed'`. The two are a contradiction, so the query
returns ZERO rows with no error. It ships unnoticed because the common case
(views that never mention the defaulted column) looks perfectly fine; only the
one view that filters ON that column comes back mysteriously empty.

## WRONG
```ts
function buildTicketListWhere(f: Filters) {
  // ...status/priority/etc filters...

  // Always hide closed tickets from queues.
  const wantsClosed = (f.status ?? []).includes('closed');
  if (f.view !== 'rated' && !wantsClosed) {
    whereClause += ` AND LOWER(t.status) != 'closed'`;
  }
  return { whereClause, params };
}

// Later, a saved-view definition compiles its own conditions and is spliced on:
//   WHERE ... AND LOWER(t.status) != 'closed'   <-- builder default
//         AND (LOWER(t.status) = 'closed')       <-- user's explicit condition
// => contradiction => empty result, no error.
```

## RIGHT
```ts
interface Filters {
  // ...
  // When a user-authored condition definition is the authority on status,
  // suppress the implicit default so it cannot contradict the user's condition.
  skipClosedHiding?: boolean;
}

function buildTicketListWhere(f: Filters) {
  // ...
  const wantsClosed = (f.status ?? []).includes('closed');
  if (!f.skipClosedHiding && f.view !== 'rated' && !wantsClosed) {
    whereClause += ` AND LOWER(t.status) != 'closed'`;
  }
  return { whereClause, params };
}

// Caller compiling a saved-view definition sets skipClosedHiding: true so the
// definition's own status conditions are the sole authority on that column.
```

## NOTES
General rule: any implicit default WHERE clause (hide closed, hide deleted,
only-open, an implicit tenant/status default) must be opt-out-able whenever a
caller supplies explicit conditions over the same column, or it will silently
contradict them and return an empty set. Prefer making the default a flag on the
shared builder rather than duplicating the builder. Related: the same builder is
where the dynamic-SQL parameter-index off-by-one lives -- keep both concerns in
one unit-tested place.
