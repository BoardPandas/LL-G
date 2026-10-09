---
tech: bash
tags: [bash-3.2, macos, heredoc, command-substitution, parse-error, hooks, portability]
severity: high
---
# macOS bash 3.2 cannot parse a heredoc directly inside $(...)

## PROBLEM
macOS ships `/bin/bash` 3.2.57, and on most Macs that is the only bash. bash 3.2
scans the body of a `$(...)` for matching quotes and parens without recognising
heredocs. An apostrophe in the heredoc body ("today's", "plan's") therefore reads
as an unterminated quote:

```
line 34: unexpected EOF while looking for matching `''
line 57: syntax error: unexpected end of file
```

The script exits 2. bash 4+ parses the same file correctly, so Linux CI stays
green and the bug ships. In a Claude Code or Codex PreToolUse hook, exit 2 means
"block", so an advisory hook that only meant to print a reminder blocks the
commit or write instead. bash parses as it goes, so the hook only dies when
execution reaches the `$(...)`, which is exactly when it had something to say.

The same bash 3.2 comsub scanner also breaks on `case` patterns without a leading
`(` and on comments containing quotes inside `$(...)`.

## WRONG
```bash
MSG=$(cat <<'EOF'
Add a section with today's date.
EOF
)

MSG=$(
if [ "$KEY" = plan ]; then
  cat <<EOF
Gotchas go in the plan's final section.
EOF
fi
)
```

## RIGHT
```bash
# The heredoc is parsed by the top-level parser, which handles it on 3.2.
reminder_text() {
  cat <<'EOF'
Add a section with today's date.
EOF
}

MSG=$(reminder_text)
```

The output is byte-identical to the original form, including `$(...)` stripping
trailing newlines. `IFS= read -r -d '' MSG <<'EOF'` also works, but it returns 1
at EOF (guard it under `set -e`) and keeps the trailing newline.

## NOTES
- Check with the real parser: `/bin/bash -n script.sh` on a Mac. Linux CI cannot
  see this. Building GNU bash 3.2.57 on Linux works with
  `CFLAGS="-std=gnu89 -fcommon -Wno-implicit-function-declaration -Wno-implicit-int -Wno-incompatible-pointer-types -Wno-int-conversion"`
  and a serial `make`.
- Hooks invoked as `bash script.sh` use the first `bash` on PATH. Putting a
  bash 3.2 first on PATH runs a whole hook test suite under 3.2.
- Related: `claude-code/hook-env-vars-do-not-exist.md` (exit 2 is the blocking
  code).
