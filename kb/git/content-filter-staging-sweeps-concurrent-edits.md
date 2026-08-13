---
tech: git
tags: [staging, git-add, concurrent-sessions, shared-working-tree, rename, refactor, sed, verification, git-diff-cached]
severity: high
---
# Staging by a content filter is not a safe substitute for explicit paths -- a repo-wide rename feeds the filter the other session's edits

## PROBLEM

On a shared working tree the known trap is `git add -A`. The natural defence is to stage
only files matching something specific to your change -- "modified **and** containing the
new string". During a repo-wide rename that defence inverts into the same failure, for a
reason that is invisible while you are doing it:

**your own `sed` writes the matching string into the other session's files.**

A rename touches every file containing the old identifier, including files a concurrent
session is midway through refactoring. After the `sed`, those files match your content
predicate exactly as strongly as the files you meant to touch. The filter cannot tell
"file I renamed" from "file I renamed that someone else is also rewriting," so their
half-finished work is staged and committed under your message.

The verification then fails in the same direction. A local build compiles the **working
tree**, which contains the other session's *uncommitted* new file (the one defining the
types their in-flight edit references). Your commit does not. So the build passes locally
and breaks in CI with `undefined:` errors naming symbols that exist on your disk --
the most disorienting possible signal, because grepping your own tree finds them.

The tell is diff size. A rename produces one-line-per-import diffs; a 48-line diff in a
"rename-only" commit is somebody else's refactor riding along.

## WRONG

```bash
# Repo-wide org rename. Deliberately avoiding `git add -A`, staging by content:
sed -i 's#OldOrg/repo#NewOrg/repo#g' $(grep -rIl 'OldOrg/repo' .)

# "Only files that contain the new path" -- feels precise, is not:
mapfile -t MINE < <(git diff --name-only | while read -r f; do
  grep -q 'NewOrg/repo' "$f" && echo "$f"; done)
git add "${MINE[@]}"          # includes files the OTHER session is refactoring,
git commit -m "Rename org"    #   because YOUR sed just put 'NewOrg/repo' in them

go build ./...                # PASSES -- tree has their uncommitted types file
git push                      # CI: undefined: pkg.TypeA, pkg.TypeB, pkg.TypeC
```

## RIGHT

```bash
# 1. Derive the path list from the rename itself, BEFORE editing, and stage that
#    explicit list -- never a predicate evaluated after the edit.
mapfile -t RENAMED < <(grep -rIl 'OldOrg/repo' . --exclude-dir=.git)
sed -i 's#OldOrg/repo#NewOrg/repo#g' "${RENAMED[@]}"
git add -- "${RENAMED[@]}"

# 2. Verify the COMMIT, not the tree. For a pure rename every staged diff should be
#    one line per import; anything larger is another session's work.
git diff --cached --stat            # scan for outliers
git diff --cached -- path/to/suspicious.go   # confirm it is only the identifier

# 3. Prove it compiles from the commit alone, not from your dirty tree:
git stash -u                         # or build a fresh worktree at the commit
go build ./... && git stash pop
#   git worktree add --detach /tmp/verify HEAD && (cd /tmp/verify && go build ./...)
```

## NOTES

- **Complements [concurrent-shared-tree-worktree.md](concurrent-shared-tree-worktree.md)**,
  which says "stage by explicit path, never `-A`." This is the case where you *believed*
  you were being explicit. A content predicate is not a path list: it is re-evaluated
  against files your own bulk edit has just modified.
- **Order matters.** Computing the file list *before* the `sed` (from the OLD string) is
  safe; computing it *after* (from the NEW string) is not. Same command, opposite outcome.
- **A green local build on a shared tree proves nothing about your commit.** The tree is
  the union of every session's uncommitted work. Verify from a stash-clean tree or a
  detached worktree at the commit -- this is the only step that would have caught it.
- **`undefined:` errors in CI for symbols that exist locally** is the signature. Before
  debugging the symbol, check whether the file defining it is committed:
  `git ls-tree -r --name-only HEAD -- path/to/defining_file`.
- Applies to any bulk mechanical edit, not just renames: license headers, import
  reordering, formatter sweeps, codemods.
