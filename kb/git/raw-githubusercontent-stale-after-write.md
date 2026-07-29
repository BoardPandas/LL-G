---
tech: git
tags: [github, api, raw-githubusercontent, cdn, cache, verification, concurrency, lost-update]
severity: medium
---
# Verifying a GitHub write via raw.githubusercontent reports a lost update that never happened

## PROBLEM

After writing a file through the GitHub contents API (`PUT /repos/{owner}/{repo}/contents/{path}`), the obvious way to confirm it is to fetch the file back from `raw.githubusercontent.com`. That URL is served by a CDN with its own TTL, so for some minutes it can return the **previous** content. Appending a cache-busting query string does not reliably defeat it.

The write succeeded. The read lied. And the conclusion the stale read invites is the dangerous part: "my commit is missing" or "something clobbered me". The natural corrective action is to re-PUT from the local copy, which, if another contributor genuinely did write to that path in between, **destroys their commit**. A stale read therefore manufactures exactly the lost update it appears to be reporting.

Observed while filing an LL-G entry: a second session was independently filing a different entry to the same two index files within the same 35 seconds. Post-write verification against `raw.githubusercontent.com` showed one file differing from what had just been uploaded and an index edit apparently missing. Both readings were false. The contents API showed every write present, and the two sessions' index edits correctly merged. Re-PUTting on the strength of the raw read would have wiped the other session's entry.

## WRONG

```bash
bash kb-upsert.sh BoardPandas/LL-G kb/x/y.md ./y.md "msg"

# CDN may still be serving the pre-write blob; the ?ts= does not reliably bust it
curl -fsSL "https://raw.githubusercontent.com/BoardPandas/LL-G/main/kb/x/y.md?$(date +%s)" \
  | diff - ./y.md    # spurious diff -> "my write was lost" -> re-PUT -> clobbers a peer
```

## RIGHT

```bash
# The contents API is read-through and reflects the commit immediately.
gh api repos/BoardPandas/LL-G/contents/kb/x/y.md --jq .content | base64 -d | diff - ./y.md

# Before concluding anything about a "lost" write, look at who actually wrote the path.
gh api "repos/BoardPandas/LL-G/commits?path=kb/x/y.md&per_page=5" \
  --jq '.[] | "\(.sha[0:7]) \(.commit.author.date) \(.commit.author.name) \(.commit.message|split("\n")[0])"'
```

## NOTES

- **If your PUT returned a URL, it landed.** `kb-upsert.sh` reads the blob SHA immediately before the PUT, so a genuine concurrent write fails the request with a 409 rather than silently overwriting. A successful response plus a "missing" raw read means the raw read is wrong, not the write.
- The commit log for the path is the cheapest ground truth: your SHA is either in it or it is not. Diffing content against a CDN cannot distinguish "not written" from "not yet propagated".
- The same staleness applies on the **read** side at session start. A `curl` of `kb/<tech>/llms.txt` may serve an index minutes old, so an entry appended earlier in the session can appear absent. Re-fetch via `gh api` before deciding an entry is missing and writing a duplicate.
- Generalises beyond this KB workflow: any write-then-verify loop against GitHub (docs sites, config repos, release manifests) needs the verify step pointed at the API, not the CDN.
- Related: `concurrent-shared-tree-worktree.md` and `stale-version-read-collides-on-push.md`, the other two ways a stale read turns a concurrent peer into silent data loss.
