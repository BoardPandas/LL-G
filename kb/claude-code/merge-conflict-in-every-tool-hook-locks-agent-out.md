---
tech: claude-code
tags: [hooks, pretooluse, git, rebase, merge-conflict, worktree, lockout]
severity: high
---
# A merge conflict inside an every-tool hook script locks the agent out of all tools

## PROBLEM
A PreToolUse hook wired with `matcher: "*"` runs before every tool call, including Read. If a
rebase or merge in the session's own working tree conflicts in that hook's script, git writes
conflict markers into the live file. Bash then fails to parse it (`syntax error near unexpected
token '<<<'`, exit 2), and exit 2 is a block, so every call is refused: Bash, Read, Edit, every
MCP tool. The agent cannot run `git rebase --abort` to get out; a human has to, from another
shell on the host where the repo lives (on 2026-09-30 the first attempt ran on the Windows
workstation while the session was on a remote Linux host, and did nothing).

Hooks run from `$CLAUDE_PROJECT_DIR`, the session repo, so a conflict in any other checkout is harmless.

## WRONG
```bash
# upstream rewrote .claude/scripts/require-ticket-release.sh (PreToolUse, matcher "*")
git rebase --autostash origin/main
# CONFLICT in .claude/scripts/require-ticket-release.sh -> every later tool call is blocked
```

## RIGHT
```bash
# 1. Detect: does upstream touch a script the hooks run?
git diff --name-only HEAD...origin/main | grep -F -f <(grep -o '\.claude/scripts/[^" ]*' .claude/settings.json | sort -u)

# 2. If so, integrate in a separate worktree; the live hook never sees markers
git worktree add -b integrate /tmp/wt origin/main
git -C /tmp/wt cherry-pick <local-commit>      # resolve conflicts and run checks there
git -C /tmp/wt commit
git reset --keep integrate                     # move main to the finished commit
git worktree remove /tmp/wt
```

## NOTES
If already locked out, the human runs `git -C <repo> rebase --abort` (or `merge --abort`) on the
host that holds the repo, e.g. over `ssh`. `--autostash` changes are restored by the abort.
Related: hook-cwd-is-not-the-commit-target-repo, concurrent-session-moves-branch.
