---
tech: git
tags: [git, windows, case-insensitive, worktree, checkout, agents-md]
severity: high
---
# Case-distinct tracked paths collide in a case-insensitive checkout

## PROBLEM

Git can track `AGENTS.md` and `agents.md` separately while a case-insensitive
working directory cannot represent them independently. A fresh worktree can
show apparent modifications unrelated to its task. Copying the whole tree
back or broadly staging its diff can overwrite instruction files or user edits.

## WRONG

```text
Assume every difference in a new agent worktree belongs to its task.
Copy the entire tree back or stage every reported change.
```

## RIGHT

```bash
# Inspect index paths and blobs, not just the files visible on disk.
git ls-files --stage -- AGENTS.md agents.md
git config --get core.ignorecase

# Transfer only assigned paths, then review the resulting patch/index.
git -C <worktree> diff HEAD -- <assigned-crate>
```

## NOTES

Hark at `9a61d11d06056d6b54b9ad6f4cd8c4fb1f2fe654` tracks two different
blobs for these spellings and reports `core.ignorecase=true` in its Windows
checkout. The handoff explicitly preserves the user's `agents.md` edit.

Changing `core.ignorecase` does not make the underlying filesystem
case-sensitive. Resolve the filename collision separately on an appropriate
filesystem with the owner's agreement; do not silently rename or remove files
as part of unrelated feature work.

Evidence: [Hark's recorded worktree collision](https://github.com/BoardPandas/Hark/blob/9a61d11d06056d6b54b9ad6f4cd8c4fb1f2fe654/tasks/2026-09-26-plan-meeting-transcription.md),
section 8, Core steps 3–8, and read-only index inspection on 2026-09-28.
