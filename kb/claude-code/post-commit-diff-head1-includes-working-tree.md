---
tech: claude-code
tags: [hooks, posttooluse, git, diff, stash, commit-summary, silent-failure]
severity: high
---
# A post-commit hook summarising with `git diff HEAD~1` reports uncommitted changes as committed

## PROBLEM
With one revision argument, `git diff <rev>` compares that revision against the WORKING TREE, not against HEAD. A PostToolUse hook that prints "what this commit contained" with `git diff HEAD~1 --stat` therefore lists staged-but-uncommitted and unstaged edits as if they had been committed.

Observed 2026-10-11: two `git rm`'d workflow files were silently unstaged by a verification `git stash` / `git stash pop` (plain pop restores the working tree but not the index, so staged deletions come back unstaged). The commit held one file; the hook's summary listed three, the agent reported the workflows deleted and pushed, and they stayed on main until a later commit.

The same hook also ran git in the session's cwd (so `git -C other commit` summarised the wrong repo) and printed nothing for a root commit (no HEAD~1).

## WRONG
```bash
git diff HEAD~1 --stat | head -20      # HEAD~1 vs working tree
```

## RIGHT
```bash
anchor_to_repo_root || exit 0          # cd to the repo the command committed to
{ git diff --stat HEAD~1 HEAD 2>/dev/null || git show --stat --format= HEAD; } | head -20
```

## NOTES
- Verify a commit with `git show --stat HEAD`, never with a hook summary or a single-rev `git diff`.
- Stashing to compare before/after: use `git stash pop --index`, or the staging is dropped silently.
- Regression tests should cover: uncommitted + staged edits not reported, `-C`/`cd` target repo, root commit. Each must fail against the old hook.
- Related: hook-cwd-is-not-the-commit-target-repo.md, hook-validates-text-not-state.md.
