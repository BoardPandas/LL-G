---
tech: git
tags: [tags, backfill, template, package-json, versioning]
severity: high
---
# Backfilling a tag per historical package.json version tags a template's version in a template-born repo's first commit and blocks the real release's tag

## PROBLEM
A repo created from a template starts with the template's package.json version (e.g. 0.25.0), then resets to its own, lower numbers. A backfill that tags every version package.json ever held tags that initial commit as v0.25.0.
When the repo really reaches 0.25.0, an auto-tag workflow that never moves existing tags skips it. The release's compare link then points at the template import. The same happens with template history carried into the changelog.

## WRONG
```bash
for sha in $(git rev-list --reverse HEAD); do
  v=$(git show "$sha:package.json" | jq -r .version); last[$v]=$sha
done   # tags every version, including the template's
```

## RIGHT
```bash
# tag only versions that have a heading in CHANGELOG.md / CHANGELOG-archive.md,
# and backfill AFTER any inherited template sections are removed
headed=$(grep -ohE '^## \[[0-9.]+\]' CHANGELOG*.md | tr -d '#[] ')
```

## NOTES
- Push only the tags a run created, filtered again by heading at push time.
- Delete stray local tags before pushing; once on the remote they are hard to retract.
