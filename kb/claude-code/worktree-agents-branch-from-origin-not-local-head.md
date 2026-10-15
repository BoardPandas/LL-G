---
tech: claude-code
tags: [worktree, isolation, subagents, git, unpushed-commits, stale-content]
severity: high
---
# Worktree-isolated subagents branch from origin/main, not your local HEAD

## PROBLEM
A subagent with `isolation: worktree` was observed to start from the remote default branch (origin/main, also where the session started), not the checkout's current HEAD. Local HEAD was a feature branch with a new commit, and local `main` held an unpushed merge; the agent's worktree sat at the older origin/main commit. So committing first is not enough: committed-but-unpushed work, and work on another local branch, are just as invisible as uncommitted edits. The agent reads stale files and reports confidently against them.

## WRONG
```bash
git commit -am "new feature"        # committed locally, not pushed
# dispatch an isolated agent to review/extend the new feature
# -> its worktree is at origin/main; it never sees the commit
```

## RIGHT
```bash
git push origin HEAD                 # or brief the agent with the exact branch/sha to check out
# in the agent brief, guard explicitly:
git log --oneline -1                 # must equal the sha the brief names; else STOP and report
```

## NOTES
Observed 2026-10-15: worktree at a736c54 (origin/main) while local HEAD was b1186c9 on a feature branch. Extends worktree-agents-miss-uncommitted-work.md. The exact base rule (origin default branch vs session start commit) was not separable in this run; either way it is not the live local HEAD. Workflows that sync main with origin before dispatching (ff-only pull, clean tree) are unaffected.
