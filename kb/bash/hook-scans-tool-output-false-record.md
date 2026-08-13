---
tech: bash
tags: [claude-code-hooks, posttooluse, psql, migrations, ledger, dry-run, positive-evidence]
severity: high
---
# A PostToolUse hook that records DB migrations on the ABSENCE of an error

## PROBLEM
A PostToolUse (matcher: Bash) hook that keeps a `schema_migrations` ledger in
sync by grepping the payload for `migrations/NNN_name.sql` records migrations
that were never applied. There are two rounds to this, and the second is the
one worth reading -- the fix for the first is what failed.

**Round 1 (scanning the output for paths).** The payload carries
`tool_input.command` AND `tool_response`. `psql` echoes the filename in its own
error output (`psql:database/migrations/345_x.sql:12: ERROR: ...`), so a hook
grepping the whole blob records failed applies, and re-inserts rows you just
deleted every time a cleanup command mentions the path. Fix: parse paths from
`tool_input.command` only.

**Round 2 (gating on the absence of an error).** The round-1 fix also added a
guard: record *unless* the output contains `ERROR:`, `ROLLBACK` or `rolled
back`. That guard is negative, and **absence of an error word is not evidence of
success**. Every one of these reads exactly like a clean apply:

- a dry-run whose output was redirected (`psql ... > /tmp/out.txt`)
- `psql -q`, which prints no status lines at all
- output truncated by the harness before the tail arrives
- an empty `tool_response` -- including the hook's own no-JSON-parser fallback,
  where the output variable is set to `""` and therefore contains no "ERROR"

So the hook stamped three migrations as applied off validation dry-runs. None of
their 23 tables existed. **The damage is not the bad rows, it is what they do to
everything below them:** a forward-only runner selects `version > MAX(version)`,
so a false row becomes the high-water mark and every lower-numbered pending
migration -- including other sessions' unrelated work -- is skipped forever
while `migrate status` reports 0 pending. One phantom row buried four migrations
and nothing anywhere reported it.

## WRONG
```bash
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' | tr '\n' ' ')
out=$(printf '%s' "$input" | jq -r '.tool_response | ...')

printf '%s' "$cmd" | grep -qiE 'psql' || exit 0
# The path merely APPEARS somewhere in the command. A dry-run names the
# migration to grep/sed to strip its COMMIT, then feeds psql the stripped body
# from a scratch file -- and matches here just the same.
files=$(printf '%s' "$cmd" | grep -oiE 'migrations/[0-9]+_[a-z0-9_]+\.sql' | sort -u)
[ -z "$files" ] && exit 0

# NEGATIVE guard: "I did not see the word ERROR, therefore it worked."
if printf '%s' "$out" | grep -qE 'ERROR:|ROLLBACK|rolled back'; then
  exit 0
fi
# ... upserts. Fires on every dry-run that printed nothing.
```

## RIGHT
```bash
# 1. STRUCTURAL: psql must have been handed the migration FILE ITSELF.
#    Extract only what psql was told to execute (-f/--file/< redirect), not
#    every path in the command. A dry-run's migration path is an argument to
#    grep, while psql's -f points at the stripped body -- so this holds no
#    matter where that body was written, with no dry-run naming convention
#    to rely on. Blank out heredoc operators first so `<<'SQL'` is not read
#    as a redirect.
scan=${cmd//<</ }
targets=$( { printf '%s\n' "$scan" | grep -oE -- '(^|[[:space:]])(--file|-f)[[:space:]=]*[^[:space:];|&<>]+'
             printf '%s\n' "$scan" | grep -oE -- '<[[:space:]]*[^[:space:];|&<>]+'; } \
  | sed -E "s/^[[:space:]]+//; s/^(--file|-f)[[:space:]=]*//; s/^<[[:space:]]*//" )
files=$(printf '%s\n' "$targets" | grep -oiE 'migrations/[0-9]+_[a-z0-9_]+\.sql' | sort -u)
[ -z "$files" ] && exit 0

# 2. Refuse anything carrying rollback intent. `psql -c BEGIN -f mig -c ROLLBACK`
#    reaches psql through -f and clears guard 1 -- and it is also the form that
#    really COMMITS, because the nested BEGIN is ignored with a warning and the
#    file's own COMMIT ends the outer transaction. Its output can show COMMIT.
printf '%s' "$cmd" | grep -qiE '(^|[^a-z_])(rollback|dry[-_]?run)([^a-z_]|$)' && exit 0

# 3. POSITIVE: require psql's bare COMMIT status line. Anchored, so an echoed
#    `COMMIT;` (from -a) or the word inside a NOTICE does not count.
committed=no
printf '%s' "$out" | grep -qE '^[[:space:]]*COMMIT[[:space:]]*$' && committed=yes

# 4. VERIFY THE CLAIM BEFORE MAKING IT. Parse the objects the file declares and
#    confirm they are actually there. A ledger row whose tables do not exist is
#    strictly worse than no row.
sql="SELECT '${obj}=' || CASE WHEN to_regclass('${obj}') IS NULL
       THEN 'MISSING' ELSE 'ok' END;"          # to_regtype for types;
                                               # information_schema.columns for ADD COLUMN
psql "$URL" -tAX -c "$sql" | grep -q MISSING && exit 0

# Demand every signal the migration is CAPABLE of producing: a file with no
# COMMIT; runs in autocommit and can never print one, so verification stands
# alone there. A file that can produce neither signal is never recorded.
```

## NOTES
- **Measured, not asserted.** Both versions of the hook were fed the *identical*
  payload -- the redirected dry-run, i.e. an empty `tool_response` -- against a
  live scratch database, with the real command text and the real psql output:

  | fed the redirected dry-run | ledger row | table |
  |---|---|---|
  | negative guard (WRONG above) | **written** | **MISSING** |
  | positive guards (RIGHT above) | none | MISSING |

  The first row is the bug in one line: a ledger row asserting a migration whose
  table does not exist. On the genuine apply the positive version then wrote its
  row and both declared objects were present, so the guards are not simply
  refusing everything -- which is the failure mode to check for, because a hook
  that never records looks identical to a correct one until the day you need it.
- **A guard that fires on the absence of a failure signal fails open.** That is
  the transferable point. Require evidence of the effect you are about to claim,
  ideally by observing the effect itself (does the table exist?) rather than by
  reading the log that describes it.
- Under-recording is the safe direction here and costs nothing: migrations are
  idempotent, so the runner re-applies and records them on the next boot. Say so
  in the hook's message, or someone will "fix" the silence by loosening it.
- Also refuse to record a version that would push the mark past a *still-pending*
  lower-numbered migration. That is the step that converts a bad row into a
  stalled queue, and it is ~6 lines. See
  [Migration ledger high-water mark lies in both directions](../postgres/ledger-high-water-mark-strands-migrations.md).
- The nested-BEGIN interaction is its own trap: see
  [Nested BEGIN/COMMIT commits the outer transaction](../postgres/nested-begin-commit-ends-outer-transaction.md).
- Test it. The hook always exits 0, so there is no exit code to assert -- drive
  it with real PostToolUse payloads and assert on whether a row was written,
  with a stub `psql` first on PATH answering from fixtures. Cover the dangerous
  cases explicitly: dry-run with output redirected away, COMMIT printed but
  tables absent, empty output blob. Then run the counterfactual: feed the OLD
  hook the same payload. A test that cannot fail proves nothing.
- To test end to end against a real database you need a fixture migration, and
  it must NOT go in the real `database/migrations/` -- the runner applies every
  numbered file it finds there on the next boot. Because the hook resolves its
  repo root from its own script location, copy it (and any helper it sources)
  into a throwaway `<tmp>/.claude/scripts/`; it then reads
  `<tmp>/database/migrations/` and the fixtures never touch the repo. Point it
  at a scratch DATABASE_URL and give that database its own `schema_migrations`.
- **The repo this came from hardened the hook, verified it against a live
  database, and then deleted it anyway.** That is the honest ending, and it is
  worth more than the patch. If the tool that owns the schema already records
  its own migrations on boot, a hook that also writes the ledger is a *second
  writer*, and two writers is the actual defect -- the ledger can disagree with
  the database, and the only symptom is migrations quietly never running. All
  the hook ever covered was the narrow case of applying a migration by hand from
  a session, bought at the price of a mechanism that could silently disable
  every future auto-migration if it guessed wrong. It guessed wrong twice.
- So: reach for deletion before hardening, and if you do keep it, give it an env
  kill switch so it can be turned off without unwiring (a script left on disk
  but unreferenced is its own silent failure). Deleting is not free either --
  a migration applied by hand is then never recorded and the next deploy
  re-applies it. Harmless for idempotent DDL, which is how migration files are
  normally written; **not** harmless for a data backfill, which runs twice.
- Related: [jq outputs pretty-printed JSON by default -- use -c for JSONL](jq-compact.md),
  [`command -v` finds a Windows Store alias stub](command-v-finds-nonexecuting-stub.md).
