---
tech: antigravity-cli
tags: [antigravity-cli, agy, headless, ci, cron, tty, gemini-cli, automation]
severity: high
---
# Antigravity CLI (agy) hangs headless and has no machine-readable output

## PROBLEM
The Antigravity CLI (the Go-rewrite `agy` binary that succeeds Gemini CLI) is interactive-first and breaks in three non-obvious ways when run unattended (CI/cron/redirected stdio):

1. **Hangs forever with no TTY.** Run non-interactively it waits on permission/confirmation prompts that never get answered. Even a trivial `agy models` produces zero output and near-zero CPU until killed. The job log shows nothing while billable minutes drain.

2. **Print mode has NO machine-readable output.** `-p/--print` renders the response to the TTY only. From a non-TTY (pipe/redirect) the captured stdout is EMPTY even though the run exits 0, calls the model, and stores the answer. There is no `--output json` to fall back on (see #3), so naive `agy -p "..." > out.txt` silently yields an empty file that looks like success.

3. **Blog-documented flags do not exist.** Third-party "run Antigravity headless" articles reference `antigravity run ... --output json --yes --no-color --prompt-file`. NONE of these exist in the real current binary (verified v1.0.8); they error with exit 2 / unknown flag. There is also no `run` subcommand.

Bonus: after install, `agy` may not resolve in an already-open shell until PATH is reloaded.

## WRONG
```bash
# Hangs forever (no stdin EOF, no auto-approve) OR exits 0 with an EMPTY out.txt
agy -p "summarize the repo" > out.txt

# These flags are from blogs and DO NOT EXIST -> exit 2, unknown flag
antigravity run --prompt-file task.md --yes --no-color --output json < /dev/null
agy --output json --yes -p "..."
```

## RIGHT
```bash
# Empty stdin (< /dev/null, Windows: < NUL) stops the hang; --dangerously-skip-permissions
# is the real auto-approve flag. Exit code is reliable (0 = success).
agy --dangerously-skip-permissions --print-timeout 2m -p "<prompt>" < /dev/null

# stdout is still empty headless. Recover the answer from the SQLite conversation store.
# The conversation id is printed to the log: "Print mode: conversation=<id>"
agy --dangerously-skip-permissions --log-file run.log --print-timeout 2m -p "<prompt>" < /dev/null
# -> read ~/.gemini/antigravity-cli/conversations/<id>.db  (latest .db by mtime holds the reply)
# Alternatively, attach a real PTY in CI so print mode writes to stdout normally.

# Real flags (verified v1.0.8): -p/--print, --dangerously-skip-permissions,
#   --print-timeout, --model, --log-file, -c/--continue, --conversation
# Real subcommands: changelog, help, install, models, plugin, update   (NO `run`)
```

## NOTES
- Verified on Windows, `agy` v1.0.8 (confirmed newest at time of writing), default model "Gemini 3.5 Flash (High)".
- Conversation/log store lives under `~/.gemini/antigravity-cli/` (`conversations/<id>.db`, `log/cli-<ts>.log`).
- If no `sqlite3` is installed, the final answer is still recoverable by extracting printable UTF-8 string runs from the `.db` bytes.
- PATH reload (Windows PowerShell): `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`.
- Generic headless hygiene still applies: empty stdin, explicit timeout, a `flock` lock to prevent overlapping runs, and unique per-run output filenames.
