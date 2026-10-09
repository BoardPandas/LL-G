---
tech: postgres
tags: [postgres, sql, uuid, text, node-postgres, mocks]
severity: medium
---
# UUID array casts must match text identifier columns

## PROBLEM

A request boundary can correctly validate every identifier as a UUID while the database stores that identifier in a TEXT column. Binding the validated strings with an explicit `uuid[]` cast then asks PostgreSQL to compare `text = uuid`, which has no implicit operator and fails only when the generated SQL reaches a real database.

A mocked `pg.Pool` that records SQL and returns fixture rows cannot detect the operator mismatch. Tests can therefore bless the exact invalid cast and stay green while the production route returns an error.

## WRONG

```sql
-- cards.oracle_id is TEXT
AND cards.oracle_id = ANY($3::uuid[])
```

## RIGHT

```sql
-- Match the parameter array to the stored column type.
AND cards.oracle_id = ANY($3::text[])
```

## NOTES

Boundary validation and TypeScript types do not change PostgreSQL storage types. Confirm the live column through `information_schema.columns`, keep a regression assertion on the generated cast, and execute a read-only production-shaped query against real PostgreSQL before trusting a mocked query test. Casting the parameter preserves the existing indexable TEXT column comparison.

