---
tech: postgres
tags: [migrations, schema-migrations, concurrency, agents, silent-failure, high-water-mark, ddl]
severity: high
---
# A forward-only migration runner skips a duplicate version forever

## PROBLEM

Hand-rolled migration runners usually select pending work as "every file whose
version is **greater than** `MAX(version)` in `schema_migrations`". That is a
high-water mark, not a ledger diff, and it is correct only while migration
numbers are unique.

They stop being unique the moment more than one author allocates the next number
at the same time. This is now the common case rather than the exotic one: several
agent sessions working in one checkout each run `ls database/migrations`, each
sees `398` as the highest, and each writes a `399_*.sql`. Nothing warns them —
the files are untracked in a shared working tree, so no git conflict ever occurs.

The failure is asymmetric and that is what makes it dangerous:

- If every `399` ships in the **same** deploy, they all apply. The bug is
  invisible and the team concludes duplicate numbers are harmless.
- If one `399` lands and deploys **first**, the high-water mark becomes 399 and
  every other `399` is now `399 > 399` = false. It is skipped on that deploy and
  on every deploy after it, forever.

There is no error, no pending entry, and no warning. `schema_migrations` looks
healthy, the runner logs "up to date", and the only symptom appears much later as
a missing table or column at runtime — against a schema the tooling reports as
current. An `ON CONFLICT (version) DO NOTHING` on the ledger insert (common, and
otherwise sensible) removes the last chance of a primary-key error surfacing it.

Renumbering is free right up until one of the colliding files is applied, and
impossible afterwards without a manual ledger edit — so the whole cost of this
bug is paid by not looking for thirty seconds before committing.

## WRONG

```ts
// Runner: forward-only on a high-water mark.
const appliedMax = await getAppliedMax(); // SELECT MAX(version) FROM schema_migrations
const pending = files
  .filter((f) => f.version > appliedMax) // <-- a duplicate of appliedMax is never > it
  .map((f) => f.name);

for (const name of pending) {
  await runFile(name);
  await db.query(
    // Hides the collision that would otherwise raise a PK violation.
    'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
    [versionOf(name)],
  );
}
```

```bash
# Author: allocates a number from a directory listing alone.
$ ls database/migrations | tail -1
398_groups_roles_tags.sql
$ $EDITOR database/migrations/399_my_feature.sql   # so did the other two sessions
```

## RIGHT

```ts
// 1. Refuse an ambiguous file set outright. This is the actual fix: the runner
//    is the only thing positioned to notice, and it costs one pass.
const byVersion = new Map<number, string>();
for (const file of files) {
  const clash = byVersion.get(file.version);
  if (clash) {
    throw new Error(
      `Two migrations share version ${file.version}: ${clash} and ${file.name}. ` +
        `Renumber one — a forward-only runner would apply whichever it saw first ` +
        `and skip the other permanently.`,
    );
  }
  byVersion.set(file.version, file.name);
}

// 2. Select by ledger membership, not by a high-water mark, so a version that
//    was never recorded is still pending whatever its number.
const applied = new Set<number>(
  (await db.query('SELECT version FROM public.schema_migrations')).rows.map((r) =>
    Number(r.version),
  ),
);
const pending = files.filter((f) => !applied.has(f.version));
```

```bash
# Author: check the shared working tree, not just tracked files, and take a
# number above everything — including other people's untracked drafts.
$ ls database/migrations/*.sql | sed 's#.*/##' | cut -d_ -f1 | sort -n | tail -1
399
$ git status --short | grep 'database/migrations'   # untracked claims from other sessions
?? database/migrations/399_privileged_audit.sql
?? database/migrations/400_durable_jobs.sql
$ $EDITOR database/migrations/401_my_feature.sql    # leave gaps; do not reuse
```

## NOTES

- **Only renumber your own file.** Another session's untracked migration is in
  flight; editing it corrupts their commit. Move yours up instead, and leave the
  gap rather than backfilling a "free" lower number later — the same reasoning
  as never renumbering an applied migration.
- **Confirm nothing has been applied yet** before renumbering:
  `SELECT MAX(version) FROM schema_migrations` against the target database. Below
  your number, you are safe; at or above it, the ledger already needs a manual fix.
- **The `IF NOT EXISTS` habit does not save you.** A skipped migration is not
  partially applied, it is entirely absent — and `CREATE TABLE IF NOT EXISTS` in
  the *next* migration will happily create a table without the constraints the
  skipped one carried. See `create-table-if-not-exists-stale-constraints.md`.
- **The same collision class hits version numbers and CHANGELOG headings** in any
  repo with concurrent authors. Migrations are the one where the consequence is
  silent and permanent rather than a merge conflict you are forced to resolve.
- Applies to any hand-rolled runner. Framework runners that key on a ledger table
  of applied filenames (Rails, Flyway, Alembic) do not have the high-water-mark
  bug, but still break on duplicate *ordering* keys — check yours rather than
  assuming.
