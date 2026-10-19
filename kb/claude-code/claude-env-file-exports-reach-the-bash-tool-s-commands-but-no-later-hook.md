---
tech: claude-code
tags: [hooks, claude-env-file, sessionstart, environment, session-id, bash-tool]
severity: high
---
# CLAUDE_ENV_FILE exports reach the Bash tool's commands but no later hook

## PROBLEM
In Claude Code, `export` lines a SessionStart hook appends to `$CLAUDE_ENV_FILE` reach the commands the Bash tool runs for the rest of the session, but no later hook. `CLAUDE_ENV_FILE` is set for SessionStart only. Hooks on UserPromptSubmit, PreToolUse, PostToolUse, Stop, PreCompact and SessionEnd get neither the file nor its exports.

A design that hands a value from SessionStart to later hooks this way reads it as empty in every later hook, with no error. That value might be a session handle, a token or a flag. The Bash-tool side works, so a check run from the Bash tool looks fine.

## WRONG
```bash
# SessionStart hook
echo "export MYTOOL_SESSION=$(mytool session start)" >>"$CLAUDE_ENV_FILE"

# PostToolUse hook, later in the session
mytool heartbeat --session "$MYTOOL_SESSION"   # empty: hooks never get CLAUDE_ENV_FILE's exports
```

## RIGHT
```bash
# SessionStart hook: the export is still right for the Bash tool's commands...
sid=$(jq -r .session_id)                      # the hook payload arrives on stdin
handle=$(mytool session start --client-session "$sid")
echo "export MYTOOL_SESSION=$handle" >>"$CLAUDE_ENV_FILE"

# ...but every later hook finds its session from its own payload's session_id.
sid=$(jq -r .session_id)
mytool heartbeat --client-session "$sid"      # or read a state file named after $sid
```
`session_id` is on every event's payload. It stayed the same across `claude -p --continue` and `/compact`.

## NOTES
- Captured on Claude Code 2.1.296 with headless `claude -p`, then `--continue`, then `/compact`. `CLAUDE_ENV_FILE` was set for SessionStart (`startup`, `resume`, `compact`) and for no other event. An `export` written there showed up in a Bash-tool `echo`, and in no later hook's environment.
- Because the Bash tool's commands get the exports, so do git hooks run by a `git commit` from the Bash tool.
- `claude-code/hook-does-not-inherit-command-env` is the same lesson from the other side: a hook does not see env set on the command it is judging either.
