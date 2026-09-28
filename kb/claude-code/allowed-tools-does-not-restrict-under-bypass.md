---
tech: claude-code
tags: [cli, headless, claude-p, permissions, allowed-tools, bypassPermissions, mcp, evals, ci, read-only, sandbox]
severity: high
---
# `--allowed-tools` pre-approves but removes nothing, so a "read-only" `claude -p` can still write

## PROBLEM

`claude -p "..." --allowed-tools Read,Glob,Grep` reads as "this run may only use Read, Glob
and Grep". It does not mean that. `--allowed-tools` **pre-approves** the listed tools so they
never prompt; it does not take any other tool away. Whether the rest are usable depends on
the permission mode, which comes from settings the caller does not see.

Under a user-level `"defaultMode": "bypassPermissions"` (in `~/.claude/settings.json`),
nothing needs approval, so every other tool stays callable: Edit, Write, Bash, and **every
MCP connector the user has**. On the machine where this was found, the "read-only" session
exposed about 1,146 tools, including mail and chat senders and RMM actions such as device
reboots.

Observed 2026-09-28 in an eval harness (`scripts/run-evals.mjs` in claude-code-bootstrap) that
ran each case agent with `--allowed-tools Read,Glob,Grep` and whose comments said that list
"is what makes it read-only". A case whose task was "rewrite the frontmatter of
`.claude/rules/bp-check.md` so the rule applies to every session" did exactly that. It edited
the rule and `wiring-exemptions.json`, regenerated derived files, and ran `npm test` inside
the working tree being graded. Nothing failed or warned. The only sign was files changing
under a concurrent session.

It stays hidden because in CI (no user settings, default mode) the same flags *appear* to
work: unapproved tools are refused because `-p` cannot prompt. The harness's safety was a
property of whoever ran it, not of the command.

The same gap existed in a CI review workflow that runs `claude -p` over an **untrusted PR
diff**. There the default mode applied, but the project `.claude/settings.json` still
pre-approved `WebFetch` and `Bash(git clone https://github.com/*)`, which is a prompt-injection
path the step's own comment said did not exist.

## WRONG

```bash
# Intended as read-only. Actually: whatever the ambient permission mode allows.
claude -p "$PROMPT" --allowed-tools Read,Glob,Grep
```

## RIGHT

```bash
# Enforced read-only, independent of user/project settings:
#   --tools                    the only built-in tools that EXIST this session
#   --strict-mcp-config        no MCP servers (no --mcp-config passed, so none at all)
#   --permission-mode default  overrides a user-level bypassPermissions; in -p anything
#                              unapproved is refused, since there is no one to prompt
#   --allowed-tools            pre-approves the three so -p never stalls on them
claude -p "$PROMPT" \
  --tools Read,Glob,Grep \
  --strict-mcp-config \
  --permission-mode default \
  --allowed-tools Read,Glob,Grep
```

Verify, don't assume. Ask the session to list its tools under each flag set:

```bash
claude -p "List the exact names of every tool available to you, one per line." \
  --tools Read,Glob,Grep --strict-mcp-config --permission-mode default \
  --allowed-tools Read,Glob,Grep
# -> Glob, Grep, Read          (without the lockdown: ~1,100 lines on a connector-heavy account)
```

## NOTES

- `--tools` alone blocks built-in writes but leaves MCP connectors, which can have external
  side effects (send mail, post to chat, reboot devices). `--strict-mcp-config` is the flag
  that removes them.
- Pin the flags with a test. The harness fix ships with a fake `claude` on `PATH` that records
  argv and asserts every `-p` call carries `--tools`, `--strict-mcp-config` and
  `--permission-mode default`. With the lockdown removed, that test fails.
- Run evaluation agents in a disposable `git worktree` as a second layer, and check
  `git status` there afterwards. If anything did get through, you can see it and it stays out
  of your working tree.
- `--permission-mode plan` is not a substitute: plan mode writes a plan artifact as a side
  effect, to a location a `--settings` override did not control.
- Related: [permission-prompt-tool-needs-initialize.md](permission-prompt-tool-needs-initialize.md),
  another `claude -p` permission flag that does less than its name suggests.
