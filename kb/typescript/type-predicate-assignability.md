---
tech: typescript
tags: [type-guards, type-predicates, drizzle, narrowing, nullable]
severity: medium
---
# TS type predicate parameter-type assignability

## PROBLEM

A user-defined type predicate `(x): x is T` only compiles if `T` is a subtype of the parameter's declared type. It is *not* enough that the runtime check correctly excludes the cases you want to drop. Trying to narrow `{ name: string | null }` to `{ name: string }` fails with TS2677 because the predicate type is not assignable to the input type, even though the runtime check (`typeof name === "string"`) is correct.

This bites most often when filtering a Drizzle query result that left-joins nullable columns: the row type has `field: T | null`, but you write a predicate that claims `field: T`. TS rejects the predicate because predicates must *refine*, not *redefine*, the parameter type.

## WRONG

```typescript
// FAILS: TS2677 -- predicate type is not assignable to row type
rows.filter((r): r is { userId: string; email: string; name: string } =>
  typeof r.email === "string" && r.email.length > 0,
);
// Drizzle returned `name: string | null` from a left join.
// Narrowing to `name: string` is rejected because the predicate
// type isn't assignable to the parameter type.
```

## RIGHT

```typescript
// FIX 1: drop the predicate -- let TS infer the filtered array's type
rows.filter((r) => typeof r.email === "string" && r.email.length > 0);

// FIX 2: keep the predicate, but match the row's nullable shape
rows.filter(
  (r): r is { userId: string; email: string; name: string | null } =>
    typeof r.email === "string" && r.email.length > 0,
);
```

## NOTES

- Predicates refine, never redefine. If you really need `name: string` downstream, do a separate map step after filtering, or build the narrowed object explicitly.
- Common with Drizzle left joins, `Array.from(map.values())`, and any `.filter()` over heterogeneous DB rows where you want to enforce non-null on a field.
- If the predicate's narrowed type genuinely diverges from the input type, that is a sign you should be mapping, not filtering.
