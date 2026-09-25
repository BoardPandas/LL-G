---
tech: claude-code
tags: [doc-sync, citations, line-numbers, git]
severity: high
---
# A doc-sync run on a dirty tree records a base commit that does not match the docs

## PROBLEM
When `/doc-sync update` runs while the code it documents is still uncommitted, the recorded base (GENERATION.md, `_toc.yaml ref_commit_hash`) is the last commit, but the cited line numbers describe the working tree, which lands later in a different commit. The next run builds old->new line maps from the recorded base and renumbers citations that were already correct. Validation passes because every renumbered line is still in range.

## WRONG
```bash
git diff "$RECORDED_BASE" -- README.md   # old side predates the content the docs cite
```

## RIGHT
```bash
DOCS_COMMIT=$(git log -1 --format=%H -- Docs/_meta/GENERATION.md)
git diff "$DOCS_COMMIT" -- README.md     # old side = what the docs actually cite
```

## NOTES
Record "tree state: dirty" in GENERATION.md with a note naming the commit that will contain the docs. Related: stale-generation-base-commit.md.
