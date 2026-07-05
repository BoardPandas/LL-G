---
tech: bash
tags: [claude-code-hooks, posttooluse, jq, psql, migrations, ledger]
severity: medium
---
# A PostToolUse hook that scans tool OUTPUT falsely records DB migrations

## PROBLEM
A PostToolUse (matcher: Bash) hook that keeps a `schema_migrations` ledger in
sync by grepping the hook payload for `migrations/NNN_name.sql` will record
migrations that were never successfully applied. The PostToolUse payload
contains both `tool_input.command` AND `tool_response` (the command's
stdout/stderr). `psql` echoes the migration filename in its own error/notice
output, e.g. `psql:database/migrations/345_x.sql:12: ERROR: ...`. So if the hook
scans the whole input+output blob:
1. A FAILED apply is still recorded as "applied" (the `ERROR:` line contains the
   path), leaving the ledger claiming a migration is live when the schema never
   changed -- a silent, hard-to-notice wrong state.
2. Unrelated commands that merely surface the path in output (a failed run, an
   `ls`/`rm`, a `cat`) re-insert ledger rows -- including rows you just deleted,
   which makes cleanup during testing impossible (they reappear every command).

## WRONG
```bash
input=$(cat)
# Scans the ENTIRE payload -- command AND psql's echoed output.
cmd=$(printf '%s' "$input" | tr '\n' ' ')
printf '%s' "$cmd" | grep -qiE 'psql' || exit 0
files=$(printf '%s' "$cmd" | grep -oiE 'migrations/[0-9]+_[a-z0-9_]+\.sql' | sort -u)
# ... upserts every $files into the ledger, even on a failed apply.
```

## RIGHT
```bash
input=$(cat)
# Parse the COMMAND ONLY -- never the output.
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' | tr '\n' ' ')
out=$(printf '%s' "$input" | jq -r '.tool_response
  | if type=="object" then ((.stdout // "") + "\n" + (.stderr // ""))
    elif type=="string" then . else "" end')
[ -z "$cmd" ] && exit 0

printf '%s' "$cmd" | grep -qiE 'psql' || exit 0
files=$(printf '%s' "$cmd" | grep -oiE 'migrations/[0-9]+_[a-z0-9_]+\.sql' | sort -u)
[ -z "$files" ] && exit 0

# Gate on success: psql -v ON_ERROR_STOP=1 prints "ERROR:" on failure; a
# validation dry-run ends in ROLLBACK. Either way, do not record.
if printf '%s' "$out" | grep -qE 'ERROR:|ROLLBACK|rolled back'; then
  echo "[hook] apply errored/rolled back; ledger NOT updated for: $files"
  exit 0
fi
# ... now safe to upsert.
```

## NOTES
- General principle: a PostToolUse hook that must attribute an effect to the
  user's action should key off `tool_input`, not `tool_response`. Tool output is
  attacker/echo-controlled and will contain paths, flags, and keywords the user
  never typed.
- When testing such a hook, clean the ledger with version-only statements
  (`DELETE ... WHERE version = N`) so the cleanup command itself contains no file
  path for the hook to re-match.
- jq is required for the fix; guard with a fallback (`command -v jq`) so the hook
  degrades to under-recording rather than breaking the workflow if jq is absent.
- Related: [jq outputs pretty-printed JSON by default -- use -c for JSONL](jq-compact.md).
