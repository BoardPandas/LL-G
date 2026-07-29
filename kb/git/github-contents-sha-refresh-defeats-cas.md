---
tech: git
tags: [github, api, contents, sha, compare-and-swap, optimistic-concurrency, lost-update, silent-failure]
severity: high
---
# Refreshing the blob SHA just before a contents-API PUT is what causes the lost update it looks like it prevents

## PROBLEM

`PUT /repos/{owner}/{repo}/contents/{path}` takes a `sha` field. It is **optimistic concurrency control**: the SHA must identify the blob your edit was *based on*, so that if anyone wrote to that path in between, GitHub rejects your request with **409** and nothing is lost.

The intuitive-but-inverted move is to fetch the current SHA immediately before the PUT, "so the value is fresh". That converts the mechanism into its opposite. A freshly-read SHA always matches HEAD, so the PUT always succeeds, and it overwrites whatever landed since you read the content. The guard is not merely absent; the code that looks like the guard is the thing performing the overwrite.

It is silent from every angle. Your PUT returns 200 with a URL. The other session's PUT also returned 200 earlier. No conflict is reported to anyone, and the loss is visible only as content quietly reverting in a later read.

A helper shipped with this exact comment:

```bash
# Read the current SHA immediately before the PUT so the update is not racing a
# stale value.
sha="$(gh api "repos/${repo}/contents/${path}" --jq .sha 2>/dev/null || true)"
```

Two sessions then appended entries to the same `llms.txt` index. Session A's update landed at 15:55:18. Session B had read the file minutes earlier, edited its local copy, and PUT at 15:55:36 — reverting A's shelf line with no error on either side. The window is not milliseconds: it is however long you spend editing between the read and the write, which for a generated or hand-edited index is minutes.

## WRONG

```bash
content=$(fetch_and_edit "$path")     # minutes may pass in here
sha=$(gh api "repos/$R/contents/$P" --jq .sha)     # <-- always matches HEAD
gh api "repos/$R/contents/$P" --method PUT -f sha="$sha" -f content="$content"
# 200 OK. Any write that landed during the edit is now gone.
```

## RIGHT

```bash
# Capture the SHA of the blob you are BASING the edit on, in the same read.
sha=$(gh api "repos/$R/contents/$P" --jq .sha)
gh api "repos/$R/contents/$P" --jq .content | base64 -d > local.txt

# ...edit local.txt, however long it takes...

gh api "repos/$R/contents/$P" --method PUT \
  -f message="msg" -f branch=main \
  -f content="$(base64 local.txt | tr -d '\r\n')" \
  -f sha="$sha"                                   # 409 if anyone wrote in between
# On 409: re-read, re-apply your edit on top of the NEW content, PUT again.
```

## NOTES

- **Verify the conflict path once.** PUT with a deliberately stale SHA (use `contents/$P?ref=<older-commit>`) and confirm you get `409 ... does not match ...` and a non-zero exit. Content-identical payloads make this test harmless. A CAS you have never seen reject anything is a CAS you have no evidence about.
- **Check the caller propagates the failure.** A helper that pipes `gh api` output through `head`/`tee`, or ends with `|| true`, turns the 409 into exit 0 and the caller proceeds as if the write landed.
- **The same helper probably mis-detects existence, too.** On a 404, `gh api --jq .sha` writes the error body to **stdout** and does not apply the jq filter, so `sha=$(gh api ... --jq .sha 2>/dev/null || true)` captures a 127-character `{"message":"Not Found",...}` instead of an empty string. Every `[ -n "$sha" ]` test then reads "the file exists" for a brand-new file and forwards that JSON blob as the `sha` field. Validate the shape (`^[0-9a-f]{40}$`), never emptiness.
- Omitting `sha` entirely does not help: the API then refuses to update an existing file at all (it is create-only), so tools reach for the refresh to make the error go away, which is how the anti-pattern spreads.
- The repair after a clobber is not a plain re-PUT of your version: re-read the current content, re-apply the *other* party's change alongside yours, and CAS on the live SHA.
- Related: `raw-githubusercontent-stale-after-write.md` (why the verification read that would have caught this also lies), and `stale-version-read-collides-on-push.md` (same read-then-write staleness against a git remote).
