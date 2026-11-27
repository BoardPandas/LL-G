---
tech: git
tags: [index, staging, git-mv, git-rm, subagents, shared-working-tree, parallel-agents, reset]
severity: high
---
# Parallel agents on one working tree share one index, so one agent's `git mv` lands in another's commit

## PROBLEM

A common way to build a large change is to give several agents disjoint folders in
one working tree and have a single lead session do every commit. Disjoint folders
keep the *files* apart. They do not keep the *index* apart: a working tree has
exactly one, and every `git mv`, `git rm`, `git rm --cached` or `git add` an agent
runs writes to it.

`git mv` is the one agents reach for without thinking, because it is the tidy way
to rename a file. It stages the rename immediately. The lead then stages its own
checkpoint by explicit path and commits, and the commit also contains the other
agent's half-finished renames and deletions, because they were already staged.
Nothing warns: `git add <my paths>` succeeds, and the commit summary lists a few
extra renames among dozens of expected lines.

The second symptom is noisier. Guards that read `git ls-files` see the index, so a
staged rename whose new file another agent is still editing, or a deletion staged
while its replacement is unstaged, makes file-length and import guards report
files that are missing or doubled.

## WRONG

```bash
# Agent A, told "you own app/devices/**":
git mv app/devices/Old.tsx app/devices/New.tsx   # staged in the shared index
git rm --cached app/devices/legacy.ts            # also staged

# Lead, committing agent B's finished checkpoint:
git add app/patching
git commit -F msg.txt     # contains A's rename and deletion as well
```

```bash
# "Fixing" it by throwing the work away:
git checkout -- .         # reverts every agent's uncommitted edits
git reset --hard          # same, plus the index
```

## RIGHT

Tell every agent, in its brief, that it may not run any command that writes the
index, and to rename with the filesystem:

```bash
mv app/devices/Old.tsx app/devices/New.tsx   # git detects the rename at commit time
rm app/devices/legacy.ts
```

Only the lead stages, by explicit path, immediately before each commit, and checks
what is staged first:

```bash
git diff --cached --name-status   # must be empty before staging a checkpoint
git add app/patching
git diff --cached --name-status   # must list only this checkpoint's paths
```

If an agent has already staged something, clear the index and leave the files
alone:

```bash
git reset -q                      # mixed reset: index back to HEAD, working tree untouched
git status --short                # the renames now show as ' D old' + '?? new'; nothing is lost
```

## NOTES

- `git reset` with no mode is `--mixed`. It never touches working-tree files, so it
  is safe with other agents mid-edit. `--hard`, `git checkout -- .` and
  `git restore .` are not.
- Read-only git (`status`, `diff`, `log`, `ls-files`, `show`) is fine for every
  agent. The line is anything that writes `.git/index`.
- If agents need to commit on their own, give each its own worktree instead. A
  worktree has its own index.
- Related: [Concurrent agents on one working tree: isolate your commit in a worktree](concurrent-shared-tree-worktree.md)
  and [`git ls-files` still lists a deleted file until the deletion is staged](git-ls-files-lists-deleted-unstaged-files.md).
