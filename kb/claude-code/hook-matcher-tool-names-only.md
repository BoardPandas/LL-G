---
tech: claude-code
tags: [hooks, settings.json, PreToolUse, PostToolUse, matcher, permission-rules, silent-failure]
severity: high
---
# Hook matcher only matches tool names, not permission-rule syntax

## PROBLEM
In `.claude/settings.json`, the `matcher` field on PreToolUse/PostToolUse hook groups matches the TOOL NAME only (`"Bash"`, `"Edit|Write"`, or a regex over tool names). Putting permission-rule syntax like `"Bash(git commit*)"` in `matcher` never matches the tool name `Bash`, so the hook silently never fires. There is no validation error and no warning: enforcement gates look configured but are dead. A template shipped this way had all four of its git-commit gates (changelog enforcement, commit-message syntax guard, post-commit prompts) doing nothing for weeks.

Argument-level filtering belongs in the `if` field on each individual hook handler, which accepts permission-rule syntax.

## WRONG
```json
"PreToolUse": [
  {
    "matcher": "Bash(git commit*)",
    "hooks": [
      { "type": "command", "command": "bash .claude/scripts/check-commit.sh" }
    ]
  }
]
```

## RIGHT
```json
"PreToolUse": [
  {
    "matcher": "Bash",
    "hooks": [
      {
        "type": "command",
        "if": "Bash(git commit*)",
        "command": "bash .claude/scripts/check-commit.sh"
      }
    ]
  }
]
```

## NOTES
- The `if` rule fires CONSERVATIVELY on commands containing opaque command substitutions. Verified empirically: `gh api ... -f content="$(base64 -w0 file)"` triggered a hook with `if: "Bash(git commit*)"` even though the command contains no git commit, while plain commands and `$(date +%Y)` did not. Blocking scripts must therefore self-filter: read the hook input JSON from stdin and exit 0 unless `tool_input.command` actually contains a git commit invocation. Treat `if` as an optimization, not the guard.
- `if` matches ANY subcommand of a compound command: `git add X && git commit` fires a hook with `if: "Bash(git commit*)"`. PreToolUse scripts that inspect repo state (e.g. "is CHANGELOG.md staged?") must account for compound commands that change that state within the same call, or they will false-positive block.
- Verify hooks empirically, not by reading config: run the guarded command and confirm the hook output/block actually appears. A dead hook is indistinguishable from a passing one unless you test the failure path.
