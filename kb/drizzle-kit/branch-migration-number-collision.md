---
tech: drizzle-kit
tags: [migrations, branches, journal, snapshot, collision]
severity: medium
---
# Two branches claim the same migration number: regenerate the unapplied one, don't renumber it

## PROBLEM
Two feature branches each generated `drizzle/0002_*.sql`. After the first merged, the second's 0002 collided:
same index, a journal entry with the same idx, and a snapshot whose `prevId` chain points at the wrong
parent. Renaming the file to 0003 by hand leaves the journal and the snapshot chain inconsistent, and the next
`drizzle-kit generate` produces a bogus diff.

## WRONG
```bash
git mv drizzle/0002_works.sql drizzle/0003_works.sql   # journal idx/tag and snapshot prevId still say 0002
```

## RIGHT
```bash
# Only for a migration NOT yet applied anywhere (remote D1 included):
rm drizzle/0002_works.sql drizzle/meta/0002_snapshot.json
# remove its entry from drizzle/meta/_journal.json, keep the other branch's 0002
pnpm drizzle-kit generate --name works   # -> 0003_works.sql, chained on the merged 0002
```

## NOTES
- Check that journal `when` values stay ascending afterwards.
- The same regenerate step is the clean way to add a column to a migration that is still unapplied.
- Never edit or regenerate an applied migration; write a new one.
