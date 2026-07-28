---
tech: claude-code
tags: [hooks, PostToolUse, CLAUDE_FILE_PATH, stdin, tool_input, formatter, biome, prettier, silent-failure]
severity: high
---
# $CLAUDE_FILE_PATH does not exist, and the empty expansion formats your whole repo

## PROBLEM
Hooks receive their input as JSON on stdin (`tool_input.file_path` for Write/Edit, `tool_input.command` for Bash). There is no `$CLAUDE_FILE_PATH` environment variable. A format-on-save hook written as

```
npx biome check --write "$CLAUDE_FILE_PATH" 2>/dev/null || true
```

therefore expands to `--write ""`.

An empty path argument is NOT a no-op. Biome (and prettier, eslint --fix, and most formatters) treat it as "no path filter" and walk the entire project, so a single one-line edit rewrites every file in the repo. In a tree with parallel agent sessions that can overwrite another session's in-progress work, and the diff shows up as an unexplained mass reformat with no obvious author.

The reason this survives is that all three failure modes are silent at once: the wrong variable expands to empty rather than erroring, the formatter succeeds on the whole repo rather than complaining, and `2>/dev/null || true` discards both the error stream and the exit code. In one repo the hook additionally had a dead matcher, so it never ran at all -- and the two defects masked each other. Fixing the matcher alone is what finally triggered the repo-wide rewrite.

A related silent failure sits next to it: a BLOCKING hook (exit 2) must write its message to **stderr**. A blocking hook's stdout is discarded, so a refusal arrives with no reason attached -- the user sees the command rejected and nothing else.

## WRONG
```json
{
  "matcher": "Write|Edit",
  "hooks": [{
    "type": "command",
    "command": "npx biome check --write \"$CLAUDE_FILE_PATH\" 2>/dev/null || true"
  }]
}
```

## RIGHT
```bash
#!/usr/bin/env bash
# Resolve from stdin JSON, and HARD-GUARD on a non-empty path before shelling out.
path=$(cat 2>/dev/null | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))
except Exception: print("")')

[ -n "$path" ] || exit 0      # no path -> do nothing. This line is the whole point.
[ -f "$path" ] || exit 0

npx biome check --write "$path" || true
exit 0
```

## NOTES
- Probe before trusting: append `printf '[%s]\n' "$path" >> /tmp/hook-probe` and make one edit. Hook stdout does not reliably surface in a tool result, so a file marker is the only honest test of whether a hook ran at all.
- Never silence a hook you have not first watched succeed. `2>/dev/null || true` converts every future breakage into silence; prefer logging to a file over discarding.
- Any hook that shells out with an interpolated path needs the non-empty guard, not just formatters. `rm`, `git add`, and test runners all reinterpret an empty argument as "everything".
- Blocking hooks: wrap the message in `{ ... } >&2` before `exit 2`. See `hook-matcher-tool-names-only.md` for the matcher/`if` contract that decides whether the hook fires in the first place.
