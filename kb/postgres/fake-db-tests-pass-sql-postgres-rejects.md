---
tech: postgres
tags: [testing, jest, fake-database, schema-drift, migrations, ddl]
severity: high
---
# Unit tests that fake the database pass SQL that Postgres rejects

## PROBLEM

A unit suite answers SQL from a fake that matches on a fragment of the text and never parses it. Two kinds of statement pass there and fail in production:

- a `SELECT DISTINCT` whose `ORDER BY` expression is not in the select list, which Postgres refuses;
- a statement naming a column that the real table does not have. A test that declares its own copy of a table tests that copy, so it cannot see a column the migrations never added.

The job failed on every tick in production and the suite stayed green. Fixing the first error exposed the second, on the same table.

## WRONG

```sql
SELECT DISTINCT a.patch_key, d.client_id
  FROM applicability a JOIN devices d ON d.id = a.device_id
 ORDER BY random();
```

```ts
// Test builds its own copy of the table; the migrations never added the column.
await pool.query(`CREATE TABLE approvals (state text, binding_digest text)`);
```

## RIGHT

```sql
SELECT pair.patch_key, pair.client_id
  FROM (SELECT DISTINCT a.patch_key, d.client_id
          FROM applicability a JOIN devices d ON d.id = a.device_id) pair
 ORDER BY random();
```

```ts
// Migrate a real database and run the statements against it.
const database = await createMigratedDatabase();
```

## NOTES

- Derive the schema from the migrations, not from a copy in the test. Give every function that runs SQL one integration test on the migrated schema.
- Seed enough data for the function to reach each statement. A sweep run on an empty database proves the query parses, not what comes after it.
- Related: [CHECK constraint or VARCHAR width narrower than the type it stores](check-constraint-narrower-than-its-type.md), the same drift in a different place.
