---
tech: claude-code
tags: [hooks, permissions, PermissionRequest, prompt-hook]
severity: medium
---
# PermissionRequest prompt hooks have no documented fall-through

## PROBLEM
A `PermissionRequest` hook runs when Claude Code is about to show a permission dialog, and is the obvious place to cut prompt fatigue: "approve the safe ones, leave the rest to me". The tempting implementation is a `type: "prompt"` hook, a single-turn LLM judge.

But a prompt hook has no documented way to say **"no opinion -- show the normal dialog"**. Its answer is effectively yes or no, and the docs do not say whether a "no" falls through to the user or **denies** the request. If it denies, the judge silently refuses legitimate work: the user never sees a dialog, the agent sees a refusal, and it routes around it or gives up. Because the judge is non-deterministic, the same command can be allowed on one run and refused on the next, which makes the failure hard to reproduce. Some template docs even recommend exactly this setup as a friction saver.

A command hook, by contrast, has a documented neutral outcome: print nothing and exit 0, and the normal permission flow continues.

## WRONG
```json
"PermissionRequest": [
  { "hooks": [ {
      "type": "prompt",
      "prompt": "Approve if this request is read-only or a project-local write; otherwise defer to the user. $ARGUMENTS"
  } ] }
]
```

## RIGHT
```json
"PermissionRequest": [
  { "hooks": [ { "type": "command", "command": "bash .claude/scripts/permission-auto-approve.sh" } ] }
]
```

```bash
#!/usr/bin/env bash
# Only ever ALLOWS, for a narrow read-only list. Everything else: print nothing, exit 0
# (documented fall-through to the normal dialog). Never deny from here -- the worst
# failure mode must be an extra prompt, not a silently refused request.
set -u
INPUT=$(cat)
command -v jq >/dev/null 2>&1 || exit 0          # no parser -> fall through, never guess
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')
[ -n "$CMD" ] || exit 0

allow() {
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}'
  exit 0
}

# Anything compound, redirected or substituted goes to the human.
case "$CMD" in
  *';'*|*'&'*|*'|'*|*'>'*|*'<'*|*'$('*|*'`'*|*$'\n'*) exit 0 ;;
esac

case "$CMD" in
  "git status"|"git status "*|"git log"|"git log "*|"git diff"|"git diff "*|"ls"|"ls "*|"pwd")
    allow ;;
esac
exit 0
```

## NOTES
- Keep the allowlist narrow and exact-prefix. Flags such as `git diff --output=FILE` or `--ext-diff` turn a "read" into a write or an execution; exclude them explicitly if you allow the base command.
- For MCP tools, judge the tool-name suffix (`mcp__<server>__<name>`), deny-list write-shaped verbs first (send, create, update, delete, post, execute, request...), then allow read-shaped names (get, list, search, read). Generic pass-through tools (`graph_request`, `*_api_call`, `execute_command`) can write and never qualify.
- Enforcement gates belong in `PreToolUse`, which runs regardless of what the PermissionRequest hook decides; the auto-approver is only a convenience layer on top.
- Test both directions: a listed read gets the allow JSON, and an unlisted command produces empty stdout with exit 0 (not a deny).
- Related on this shelf: `hook-env-vars-do-not-exist.md` (input is JSON on stdin), `blocking-hook-stdout-discarded.md`.
