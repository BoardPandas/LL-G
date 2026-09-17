---
tech: architecture
tags: [migration, backfill, lazy-evaluation, secrets, encryption-at-rest, data-model, coverage]
severity: high
---
# A lazily-migrated record only migrates if something reads it

## PROBLEM
Moving a field to a new representation -- encrypting a secret at rest, reshaping a
column, renaming a key -- is often done lazily. The read path detects the old shape,
converts it, writes the new one, and returns. No migration window, no downtime, and
genuinely correct for every record that gets read.

The defect is the records nothing reads. A lazy migration's coverage is exactly the
set of rows something touched, which is not the table. Rows belonging to dormant
tenants, disabled features, or accounts that configured a thing and never used it stay
in the old representation indefinitely. Nothing reports it, because the shim has no
notion of "remaining" -- it looks finished the moment active traffic has converted.

That is untidy when the old representation is a differently-shaped column. It is a
vulnerability when the old representation is a **plaintext secret**. Real case: BYOK
provider API keys moved into an encrypted credentials table, migrated on load. Two
tenants used the product and converted within days. A third had saved a key and never
run a single turn, so its key sat in cleartext in a JSON settings column for months --
readable by anything holding a database connection, and liable to ride along in any
endpoint returning that settings blob. It was found by querying the table, not by any
test, alert, or scan.

Three properties make it hard to spot:

- **The lazy path's tests pass.** They exercise a record being read, which is the case
  that works. The uncovered case has no test because it has no code path.
- **Grepping the source finds only the shim**, which reads as proof the old shape is
  handled -- not as proof rows still hold it. The question is about data, and only the
  data answers it.
- **The backfill is usually fire-and-forget** (`void (async () => ...)().catch(...)`)
  so that migrating never delays the read. A failure is then invisible on top of being
  unscheduled.

## WRONG
```ts
// Migrates only the tenants whose config something actually loads.
export async function loadConfig(db: Db, mspId: string) {
  const row = await one(db, 'SELECT settings, payload FROM ... WHERE id = $1', [mspId]);
  if (row.payload) return decrypt(row.payload);        // already migrated

  const legacy = resolveLegacy(row.settings);           // plaintext, old shape
  if (!legacy) return null;

  void (async () => {                                   // fire-and-forget backfill
    await db.query('INSERT INTO credentials ... ON CONFLICT DO NOTHING',
      [encrypt(legacy.apiKey)]);
    await db.query('UPDATE msps SET settings = $1 WHERE id = $2',
      [stripPlaintext(row.settings), mspId]);
  })().catch((e) => console.error('[migrate] failed:', e?.message));

  return legacy;
}
// A tenant that saved a key and never ran a turn keeps it in cleartext forever.
// Nothing counts how many are left, so nothing ever says "not done".
```

## RIGHT
```ts
// Keep the lazy path for freshness; add a sweep that does not wait to be asked.
export async function backfillEncryptedKeys(db: Db): Promise<number> {
  const { rows } = await db.query(
    `SELECT id, settings FROM msps
      WHERE settings->'ai'->>'api_key' IS NOT NULL
         OR settings->'anthropic'->>'api_key' IS NOT NULL`);

  let moved = 0;
  for (const row of rows) {
    const legacy = resolveLegacy(row.settings);
    if (!legacy) continue;

    // DO NOTHING, not DO UPDATE: an existing new-shape row is the newer truth,
    // and the old copy beside it is stale. Never overwrite it.
    await db.query(`INSERT INTO credentials (...) VALUES (...)
                    ON CONFLICT (...) DO NOTHING`, [encrypt(legacy.apiKey)]);

    // A row existing is not proof it holds a usable value. Read the new
    // representation back and verify it BEFORE clearing the last readable copy.
    const stored = await one(db, 'SELECT payload FROM credentials WHERE ...', [row.id]);
    try {
      if (!decrypt(stored?.payload).apiKey) throw new Error('empty');
    } catch (error) {
      console.error(`[migrate] ${row.id} did not verify; left the old copy in place`);
      continue;                                          // fail safe, not silent
    }

    await db.query('UPDATE msps SET settings = $1 WHERE id = $2',
      [stripPlaintext(row.settings), row.id]);
    moved += 1;
  }
  return moved;                                          // a number you can assert on
}
// Call it at boot (or as a scheduled job). Idempotent, non-fatal, and it logs a
// count -- so "0 remaining" becomes observable instead of assumed.
```

## NOTES
- **The rule:** any lazy/on-read migration needs a companion sweep that enumerates the
  remaining rows on its own schedule. The lazy path is an optimisation for hot records;
  it is not a migration strategy, because it cannot report completion.
- **Ordering matters.** Write the new representation, read it back, verify it, and only
  then delete the old one. Writing the new copy and clearing the old in the same
  unverified step turns a migration bug into permanent data loss.
- **`ON CONFLICT DO NOTHING` vs `DO UPDATE` is load-bearing** and easy to get backwards.
  Once a record has a new-shape value, the old-shape copy is stale by definition;
  clobbering the new value with it silently reverts a correct migration. Mutation-test
  this specific line -- a test double that implements conflict semantics itself will
  pass either way and prove nothing. Make the double honour whichever clause the SQL
  actually carries.
- **Verify against real data, not only fixtures.** Run the sweep against production
  inside `BEGIN ... ROLLBACK` and diff before/after. That is what showed one tenant
  migrating and the others correctly untouched, with no production write.
- **When the old representation is a secret, migrating it is not remediation.** Anything
  with database access could have read it for the whole window. Moving it into the vault
  closes the hole; rotating the credential is what closes the exposure. Check whether
  the key is live before deciding which you need.
- Related: the same "coverage is not the table" shape appears whenever a job's progress
  is inferred from the work it happened to do rather than from the work outstanding.
