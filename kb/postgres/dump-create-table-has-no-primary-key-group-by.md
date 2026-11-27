---
tech: postgres
tags: [pg_dump, schema, temp-table, primary-key, group-by, integration-test, jest]
severity: medium
---
# A test table built from a dump's `CREATE TABLE` has no primary key, so `GROUP BY id` stops covering the other columns

## PROBLEM
`pg_dump` writes each table as a bare `CREATE TABLE` and adds the primary key later, in a separate `ALTER TABLE ... ADD CONSTRAINT ... PRIMARY KEY`. An integration test that builds session-local tables by lifting only the `CREATE TABLE` statement out of the schema dump therefore gets tables with no key.

Postgres lets a query select ungrouped columns only when the `GROUP BY` column is the table's primary key (functional dependency). So a production query that is perfectly valid fails in the test with:

```
error: column "j.title" must appear in the GROUP BY clause or be used in an aggregate function
```

The error points at the query under test, not at the fixture, which sends you looking for a bug in SQL that has run in production for months.

## WRONG
```ts
const definition = schema.match(/CREATE TABLE public\.jobs \([\s\S]*?\n\);/)![0];
await client.query(definition.replace('CREATE TABLE public.jobs', 'CREATE TEMP TABLE jobs'));
// SELECT j.id, j.title, COUNT(e.id) FROM jobs j LEFT JOIN executions e ... GROUP BY j.id  -> fails
```

## RIGHT
```ts
await client.query(definition.replace('CREATE TABLE public.jobs', 'CREATE TEMP TABLE jobs'));
// The dump adds keys in separate statements; the query's GROUP BY relies on this one.
await client.query('ALTER TABLE jobs ADD PRIMARY KEY (id)');
```

## NOTES
- The same fixture style also lacks unique constraints, foreign keys, indexes and defaults added by later statements. `ON CONFLICT (col)` fails the same way without its unique constraint.
- Related: [A parameter used in two places of an `INSERT ... SELECT` needs explicit casts](insert-select-reused-parameter-needs-casts.md). A fixture `INSERT` that passes one parameter as a uuid and again as `$1::text` fails with "inconsistent types deduced for parameter $1"; write `($1::uuid)::text`.
- Neither failure can be seen without real Postgres, so a suite that is skipped locally hides both until CI.
