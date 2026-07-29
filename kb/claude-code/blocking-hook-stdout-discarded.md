---
tech: claude-code
tags: [hooks, pretooluse, exit-2, stderr, stdout, blocking, settings-json]
severity: high
---
# A blocking hook's stdout is discarded, so the block lands with no reason attached

## PROBLEM

A `PreToolUse` hook blocks a tool call by exiting 2. Only **stderr** is fed back
to the agent on that path -- stdout is discarded. A hook that `echo`s its refusal
normally (stdout) still blocks correctly, but the explanation evaporates and the
agent receives only:

```
PreToolUse:Bash hook error: [bash .claude/scripts/check-changelog-staged.sh]: No stderr output
```

The agent is now stuck in the worst possible state: the action is refused, and
nothing tells it what to fix or that a documented opt-out exists. It cannot
self-correct, so it retries the same command, guesses, or works around the guard.

Three things make this hard to spot:

1. **The hook looks like it works.** It blocks, exit code and matcher are both
   correct, and the script prints fine when run by hand in a terminal.
2. **The non-blocking path is not affected.** Advisory messages on the `exit 0`
   branches (`"SKIP_CHANGELOG=1 set -- bypassing"`) DO reach the session on
   stdout. So the author sees stdout working and reasonably assumes it works
   everywhere. The asymmetry is only on exit 2.
3. **The harness message names the script**, which reads like the script itself
   crashed. It sends you looking for a bug in the hook instead of at where its
   output went.

The more carefully written the refusal -- naming the fix, documenting the escape
hatch -- the more is lost.

## WRONG

```bash
#!/usr/bin/env bash
# .claude/scripts/check-changelog-staged.sh   (PreToolUse, matcher "Bash")

staged=$(git diff --cached --name-only 2>/dev/null)

if echo "$staged" | grep -q "^CHANGELOG.md$"; then
  exit 0
else
  echo "BLOCKED: CHANGELOG.md is not staged. Update the changelog and version first."
  echo "(Merge commits are exempt. For a trivial commit, prefix with SKIP_CHANGELOG=1.)"
  exit 2   # both echoes went to stdout -- both are discarded, block reason lost
fi
```

## RIGHT

```bash
#!/usr/bin/env bash
staged=$(git diff --cached --name-only 2>/dev/null)

if echo "$staged" | grep -q "^CHANGELOG.md$"; then
  exit 0
else
  # Group the whole message and redirect once, so a later added line cannot be
  # appended without the redirect and silently vanish again.
  {
    echo "BLOCKED: CHANGELOG.md is not staged. Update the changelog and version first."
    echo "(Merge commits are exempt. For a trivial commit, prefix with SKIP_CHANGELOG=1.)"
  } >&2
  exit 2
fi
```

## NOTES

Verify by stream, not by eye -- a hook that prints correctly in a terminal proves
nothing, because the terminal merges both streams:

```bash
printf '{"tool_input":{"command":"git commit -m x"}}' | bash .claude/scripts/the-hook.sh \
  1>/dev/null 2>/tmp/err; echo "stderr bytes: $(wc -c < /tmp/err)"
```

Zero bytes on a script that exits 2 is the defect. Repo-wide sweep:

```bash
grep -rln 'exit 2' .claude/scripts/ | xargs -r grep -Ln '>&2'
```

Prefer `{ ...; } >&2` over per-line `>&2`: the failure mode recurs the moment
someone appends one more `echo` and forgets the redirect.

Cross-references:

- [$CLAUDE_FILE_PATH does not exist](hook-empty-path-formats-repo.md) closes with
  this same fact as a trailing clause. It is recorded there, but subordinate to a
  different failure, so nobody searching "hook blocked with no message" finds it.
  The searchable string is `No stderr output`.
- [Hook matcher only matches tool names](hook-matcher-tool-names-only.md) and
  [walk argv, not regex](hook-git-commit-filter-needs-argv-walk.md) cover whether
  the hook fires at all; this entry covers what happens after it correctly does.
- This is check **I** of the BP practice `claude-config/claude-wiring-audit.md`,
  which sweeps for it alongside the other silent-wiring failures.

Observed 2026-07-29 on BoardPandas/Hark: reproduced (stdout 191 bytes, stderr 0),
fixed, and re-verified (stderr 191 bytes, exit 2 preserved).
