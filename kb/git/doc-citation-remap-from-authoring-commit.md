---
tech: git
tags: [documentation, citations, line-ranges, git-blame, git-diff, doc-sync, remap]
severity: medium
---
# Re-anchor doc citations from each line's authoring commit, not the wiki's base commit

## PROBLEM
Docs that cite source as `path#Lstart-Lend` drift as files grow. The obvious bulk fix
remaps every range through `git diff <base>..HEAD`. That is wrong for any page that was
partly refreshed after the base, because those citations were written against a later
tree and get shifted twice.

A citation checker that only tests "file exists and range <= EOF" passes all of this.
In one refresh, about 700 citations had moved. Several were already wrong at the old base
(`retention.ts`, `routes.ts`, `server.ts`, `PercyContext.tsx`), mapped cleanly, and still
passed the checker. A remap proves a citation moved with the code, not that it was ever
right.

## WRONG
```bash
# One base for every citation on the page
git diff -U0 "$BASE" HEAD -- "$file"   # shift every range by these hunks
node check-doc-citations.mjs            # "0 out of range" -> done
```

## RIGHT
```bash
# 1. For each doc line holding a citation, find the commit it was written at
C=$(git blame -L "$n,$n" --porcelain "$doc" | head -1 | cut -d' ' -f1)
# 2. Map that citation's range from C to HEAD through the file's own hunks.
#    Insertions before the range shift it; a hunk inside it marks it "touched" for review.
git diff -U0 "$C" HEAD -- "$file"
# 3. Whole-file 1-N citations track the current length
wc -l < "$file"
# 4. Eyeball the first line of each remapped range in high-churn files.
#    Flag ranges that start on a blank line or a lone `}`.
sed -n "${start}p" "$file"
```

## NOTES
- Prose that quotes a code comment can outlive the comment. Grep for the quote before
  keeping it.
- A link validator that resolves only relative to the doc's directory misreports
  repo-root citations: `README.md#L550` cited from `docs/OVERVIEW.md` resolves to
  `docs/README.md`. Try doc-relative, then repo-root.
- Builder subagents with worktree isolation write to `.claude/worktrees/agent-*`, not
  the main tree. Copy their files back and `cmp` them before removing the worktrees.
