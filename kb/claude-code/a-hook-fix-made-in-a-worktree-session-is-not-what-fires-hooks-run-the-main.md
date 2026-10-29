---
tech: claude-code
tags: [hooks, worktree, posttooluse, verification, git]
severity: high
---
# A hook fix made in a worktree session is not what fires: hooks run the main checkout's copy of the script

## PROBLEM
In a Claude Code session running in a git worktree, hooks can execute the main checkout's copy of `.claude/scripts/*.sh`, not the worktree's edited copy.
So after fixing a hook in the worktree, the live hook that fires on your next command still shows the old behaviour. It looks as if the fix failed, or worse, the old output is taken as proof the fix works. The worktree's tests pass, and the live run disagrees with no error to explain why.

## WRONG
```bash
# edit .claude/scripts/post-commit-hook.sh in the worktree, commit,
# then judge the fix by the hook output that fires on that commit
cd <worktree> && git commit -m "fix hook"
# -> hook output still shows the old (main checkout) behaviour
```

## RIGHT
```bash
# verify by running the edited script directly with a replayed payload
printf '%s' '{"tool_input":{"command":"cd <worktree> && git commit -m x"}}' \
  | bash <worktree>/.claude/scripts/post-commit-hook.sh
# then merge, and pull into the main checkout before expecting the live hook to change
git -C <main-checkout> pull --ff-only
```

## NOTES
Check which copy ran: grep the main checkout's script for a marker from your fix. `$CLAUDE_PROJECT_DIR` may be empty in the Bash tool's environment, so it is no help here. Related: worktree-agents-miss-uncommitted-work, hook-cwd-is-not-the-commit-target-repo.
