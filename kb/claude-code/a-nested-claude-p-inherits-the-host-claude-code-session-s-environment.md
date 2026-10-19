---
tech: claude-code
tags: [claude-p, headless, nested-session, environment, env-i, hooks, testing]
severity: medium
---
# A nested `claude -p` inherits the host Claude Code session's environment

## PROBLEM
A command run by Claude Code's Bash tool gets Claude Code's own environment, so a headless `claude -p` started from there inherits the host session's variables. From a desktop-app session that is more than 30 variables, including:
- `CLAUDECODE=1` and `CLAUDE_CODE_ENTRYPOINT`
- `CLAUDE_CODE_SESSION_ID` and `CLAUDE_CODE_HOST_SESSION_ID`
- `CLAUDE_CODE_CHILD_SESSION=1` and `CLAUDE_CODE_SESSION_ATTENDED=1`
- `CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_MESSAGING_TOKEN`
- switches such as `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` and `CLAUDE_EFFORT`
- whatever `ANTHROPIC_BASE_URL` the host was given

The child starts with the host's switches and identity variables in place of the user's own defaults, and passes them on to the hooks it runs unless it overwrites them. So a test meant to show what a fresh session does measures a mix of host and child, and nothing says so. Such tests include which events fire, what a hook's environment holds, whether an MCP server signs in, and what a setting defaults to.

## WRONG
```bash
# From Claude Code's Bash tool: capture what a fresh session's hooks receive
cd /tmp/scratch-ws && claude -p 'Run: echo ok' --model haiku </dev/null
# The child and its hooks carry the host's CLAUDE_CODE_* variables unless the child overwrites them
```

## RIGHT
Start the child with a minimal environment, as a fresh terminal would:
```bash
cd /tmp/scratch-ws && env -i HOME="$HOME" PATH="$PATH" USER="$USER" LANG="${LANG:-C.UTF-8}" \
  SHELL=/bin/bash TERM=dumb claude -p 'Run: echo ok' --model haiku </dev/null
```
Add back only what the test needs, by name. Then check the child is still signed in. On Linux the login is in `~/.claude/.credentials.json`, so `HOME` carries it. Elsewhere, confirm it.

## NOTES
- The names come from a Claude Code 2.1.296 desktop-app session's Bash tool. What each variable does in a child was not tested one by one. `ANTHROPIC_BASE_URL` (API routing) and `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` (agent teams) are documented switches, so those two alone change how the child runs.
- The messaging socket and token are the host session's own channel, so keep them out of any child process.
- Start other agent CLIs (`codex exec`, `agy -p`) the same way when the test is about their fresh behaviour.
- `env -i` also drops what a script may need, such as `SSH_AUTH_SOCK`, `XDG_RUNTIME_DIR` or proxy settings. Add those back explicitly.
