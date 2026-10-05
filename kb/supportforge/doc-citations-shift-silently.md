---
tech: supportforge
tags: [docs, citations, check-docs, line-numbers, doc-sync]
severity: medium
---
# Line-anchored doc citations shift silently when you edit the cited file

## PROBLEM
SupportForge docs cite source as `[src/server.ts:167-233](src/server.ts#L167-L233)`. `check:docs` (scripts/check-doc-citations.mjs) fails only on missing files and ranges past end-of-file. Inserting lines into a heavily cited file (server.ts, routes.ts, oauth.ts, ci.yml, Dockerfiles) silently mis-points citations in ~9 docs; CI stays green.

## WRONG
```bash
# edit src/server.ts (+7 lines), run check:all, ship -- citations now point 7 lines early
```

## RIGHT
```bash
# for each edited file, map old->new lines from the diff hunks and rewrite citations:
git diff -U0 origin/main -- src/server.ts   # @@ -a,b +c,d @@ hunks give the shift
# rewrite both the link text (path:a-b) and anchor (#La-Lb) in docs/ (skip docs/archive)
# then fix by hand any citation that landed INSIDE a changed hunk
```

## NOTES
Exclude citations you just wrote against the NEW file from the remap, or they get shifted twice. Code moved to another file needs its citation repointed by hand. Note the remap in the CHANGELOG ("doc citations now point at the shifted line numbers").
