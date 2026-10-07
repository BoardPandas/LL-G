---
tech: claude-code
tags: [hooks, pretooluse, posttooluse, stdout, additionalContext, advisory, codex]
severity: high
---
# An advisory tool hook that prints plain stdout is silently inert

## PROBLEM
Plain stdout from a command hook reaches the model only for `SessionStart`,
`UserPromptSubmit`, `UserPromptExpansion` and `PostModelSwitch`
(code.claude.com/docs/en/hooks, verified at Claude Code 2.1.292). For `PreToolUse`,
`PostToolUse` and every other event it goes to the debug log. An advisory hook that
echoes a reminder and exits 0 runs on every call, succeeds, and Claude never sees a word.
Nothing errors. Four advisory hooks in one repo (plan, file-write and post-commit
knowledge-base reminders, plus a changelog reminder) were inert for months this way.
Codex CLI behaves the same: `codex-rs/hooks/src/events/pre_tool_use.rs` ignores non-JSON
stdout on PreToolUse/PostToolUse.

## WRONG
```bash
# PreToolUse hook on Write|Edit
echo "=== CHECK LL-G BEFORE WRITING THIS FILE ==="
exit 0
```

## RIGHT
```bash
json_escape() {
  local s; s=$(printf '%s' "$1" | tr -d '\000-\010\013\014\016-\037')
  s=${s//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\t'/\\t}; s=${s//$'\r'/\\r}; s=${s//$'\n'/\\n}
  printf '%s' "$s"
}
MSG="=== CHECK LL-G BEFORE WRITING THIS FILE ==="
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"%s"}}\n' \
  "$(json_escape "$MSG")"
exit 0
```

## NOTES
- Same shape with `"hookEventName":"PostToolUse"`. `hookEventName` must match the event
  the hook is registered on. Never hand-concatenate the JSON: a file path with a quote or
  backslash breaks it.
- To BLOCK, exit 2 with the reason on stderr instead; see
  `blocking-hook-stdout-discarded.md` for that direction.
- Test it: parse the hook's stdout as JSON in the hook test suite, then mutation-test by
  swapping the emitter for a plain `printf` and confirming the test fails.
