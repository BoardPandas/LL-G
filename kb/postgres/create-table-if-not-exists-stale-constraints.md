---
tech: postgres
tags: [schema, ddl, constraints, foreign-key, on-delete-cascade, migration, idempotency, schema-on-startup]
severity: high
---
# CREATE TABLE IF NOT EXISTS never retrofits constraints onto existing tables

## PROBLEM
A common pattern is to keep the whole schema in one `schema.sql` and apply it on every process boot using `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` for idempotency. The trap: when you later add or change a **column-level constraint** (e.g. add `ON DELETE CASCADE` / `SET NULL` to a foreign key) by editing the inline column definition in `schema.sql`, the `IF NOT EXISTS` guard means the whole `CREATE TABLE` statement is skipped on any database where the table already exists. The new constraint clause never runs. The source code reads as correct, dev (fresh DB) looks correct, but every long-lived database (prod) keeps the OLD constraint definition forever.

Symptom we hit: deleting a parent row (`DELETE FROM styles`) relied on `ON DELETE CASCADE` that was present in `schema.sql` but absent on the live prod table. The delete threw a foreign-key violation that the server turned into a 500, which surfaced in the UI as a generic "couldn't complete that action." The bug is invisible to code review because the schema file looks right.

This is the constraint sibling of the well-known fact that `CREATE TABLE IF NOT EXISTS` also never adds new *columns* to an existing table. Same root cause: the guard suppresses the entire statement, not just the create.

## WRONG
```sql
-- schema.sql, applied on every boot with CREATE TABLE IF NOT EXISTS.
-- Someone edited this table months after it first shipped to add ON DELETE
-- CASCADE. On prod the table already exists, so this statement is skipped
-- and the FK keeps its original NO ACTION behavior. Cascades silently fail.
CREATE TABLE IF NOT EXISTS style_examples (
  id        BIGSERIAL PRIMARY KEY,
  style_id  TEXT REFERENCES styles(id) ON DELETE CASCADE,  -- never applied to old DBs
  ...
);
```
```ts
// App code trusts the cascade that prod doesn't actually have.
export async function deleteStyle(id: string) {
  const pool = await getPostgresPool();
  await pool.query(`DELETE FROM styles WHERE id = $1`, [id]); // 500 on prod: FK violation
}
```

## RIGHT
```ts
// Option 1 (most robust): don't depend on the cascade clause being live.
// Delete children explicitly in FK-safe order inside a transaction. Works
// regardless of the database's actual constraint state.
export async function deleteStyle(id: string) {
  const pool = await getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Null the parent's own pointers into soon-to-be-deleted children first.
    await client.query(`UPDATE styles SET cover_example_id = NULL WHERE id = $1`, [id]);
    // Detach descendants that merely reference this row (schema: SET NULL).
    await client.query(`UPDATE styles SET parent_style_id = NULL WHERE parent_style_id = $1`, [id]);
    // Hard-delete owned child rows (schema: CASCADE), deepest dependents first.
    await client.query(`DELETE FROM style_examples WHERE style_id = $1`, [id]);
    await client.query(`DELETE FROM styles WHERE id = $1`, [id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```
```sql
-- Option 2: retrofit the constraint with an idempotent DO block that
-- introspects the LIVE definition and only ALTERs when it differs. Safe to
-- run on every boot alongside the CREATE TABLE IF NOT EXISTS statements.
-- pg_constraint.confdeltype: 'a'=NO ACTION, 'r'=RESTRICT, 'c'=CASCADE,
-- 'n'=SET NULL, 'd'=SET DEFAULT.
DO $$
DECLARE
  conname text;
  deltype "char";
BEGIN
  SELECT c.conname, c.confdeltype INTO conname, deltype
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'style_examples'::regclass
    AND c.contype = 'f'
    AND a.attname = 'style_id';

  IF conname IS NOT NULL AND deltype <> 'c' THEN
    EXECUTE format('ALTER TABLE style_examples DROP CONSTRAINT %I', conname);
    ALTER TABLE style_examples
      ADD CONSTRAINT style_examples_style_id_fkey
      FOREIGN KEY (style_id) REFERENCES styles(id) ON DELETE CASCADE;
  END IF;
END $$;
```

## NOTES
- The same blind spot applies to **adding columns**: `CREATE TABLE IF NOT EXISTS` will not add a new column to an existing table either. Use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for that case.
- Reliable tell: search `schema.sql` history for any constraint/column change that was made *after* the table first shipped. Anything edited inline after first deploy is suspect on long-lived databases.
- Prefer real, versioned migrations (a migration runner that tracks applied versions) over a single boot-applied `schema.sql` once a project has a production database. Boot-applied schemas are fine for create-only, dangerous for alter.
- Verifying the live state: `SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = '<table>'::regclass AND contype = 'f';` shows the actual on-delete action per FK, independent of what the schema file claims.
- Cross-ref: the architecture index covers source-of-truth drift; this is the DDL-level instance of "the file says X, the running system is Y."
