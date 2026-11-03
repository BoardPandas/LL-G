---
tech: github-actions
tags: [tags, release, github-token, on-push-tags, backfill]
severity: high
---
# An auto-tag workflow using GITHUB_TOKEN claims the tag a human release push needs, so a tag-triggered release never fires

## PROBLEM
Tags pushed with GITHUB_TOKEN start no workflows. A push that carries more than three tags creates no push events at all.
That makes bulk tag backfills safe. It also means an auto-tag-on-push workflow added to a repo whose releases run on `on: push: tags: [v*]` silently breaks releases. The workflow creates `vX.Y.Z` first, the maintainer's own tag push is then rejected or is a no-op, and the signed release build never runs.

## WRONG
```yaml
on: { push: { branches: [main] } }   # added to every repo, including one with release.yml on push tags
jobs: { tag: { steps: [ { run: 'git tag -a "v$V" -m "$V" && git push origin "v$V"' } ] } }
```

## RIGHT
```bash
# before adding an auto-tagger, check for tag-triggered workflows
grep -lE '^\s*tags:' .github/workflows/*.y*ml   # then read the on: block; docker "tags:" is not a trigger
# tag-triggered repo: no auto-tagger, no backfill; link only the tags that exist
```

## NOTES
- `tags:` also appears in Docker action inputs; read the `on:` block, not the grep hit.
- Pushing backfilled tags in batches of more than 3 keeps tag-triggered workflows quiet.
