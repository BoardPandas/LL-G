---
tech: git
tags: [git, diff, binary, patch, git-apply, worktree, agents, handoff]
severity: medium
---
# `git diff` without `--binary` leaves a new binary file out of the patch, and the patch still looks complete

## PROBLEM
A plain `git diff` (or `git diff --cached`) represents a changed or new binary file as one line, `Binary files /dev/null and b/icon.png differ`, with no content. When you collect someone's work this way (an agent's worktree, a patch for another checkout, a diff pasted into a review), every text change is present and the binary file is not. `git apply` refuses the whole patch loudly (`cannot apply binary patch to 'icon.png' without full index line`), but anything that works from the text alone (a review of the diff, a hand-copied set of hunks, a script that splits it per file) sees every text change, finds nothing missing, and carries on without the file. The missing asset shows up later, for example as a server that fails to boot because an image it loads at startup is absent.

## WRONG
```bash
git -C ../agent-worktree add -A
git -C ../agent-worktree diff --cached > work.patch     # binary file reduced to "Binary files differ"
git apply work.patch                                     # refuses the whole patch; a text-only consumer never notices
```

## RIGHT
```bash
git -C ../agent-worktree add -A
git -C ../agent-worktree diff --cached --binary > work.patch   # carries a "GIT binary patch" block
git apply work.patch
git status --short                                             # confirm the binary file arrived
```

## NOTES
- `git diff --stat` lists binary files with `Bin`; scan it for them before trusting a patch.
- Prefer a branch or `git format-patch --binary` over loose diffs when handing work between worktrees.
- Remember `git add -A` first so untracked new files are part of the diff at all.
