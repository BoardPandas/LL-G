---
tech: bash
tags: [gh, github-cli, api, error-handling, command-substitution, silent-failure]
severity: high
---
# `gh api` prints the HTTP error body on STDOUT, so `2>/dev/null || true` captures it as the value

## PROBLEM

On an HTTP error `gh api` writes three things: the **response body to stdout**,
a one-line human summary to stderr (`gh: Not Found (HTTP 404)`), and a nonzero
exit code. The idiomatic "look it up, empty if absent" line therefore does the
opposite of what it reads like:

```sh
sha="$(gh api "repos/${repo}/contents/${path}" --jq .sha 2>/dev/null || true)"
```

`2>/dev/null` hides the summary. `|| true` hides the exit code. Stdout still
carries the 404 JSON, so `$sha` is **not empty** -- it holds the 127-byte
`{"message":"Not Found","documentation_url":"...","status":"404"}`.

`--jq` does not save you: the filter is not applied to an error body, which
passes through raw. `gh api ... --jq .sha` on a 404 yields the whole error
object, not empty and not a jq error. Measured on gh 2.100.0:

| invocation | exit | stdout |
|---|---|---|
| `gh api <404> --jq .sha` | 1 | 127 bytes of error JSON |
| `gh api <404>` | 1 | 127 bytes of error JSON |
| `gh api <404> --silent` | 1 | 0 bytes |

How much this hurts depends on what consumes the value, and the worst case is
the quiet one:

- An emptiness test (`if [ -n "$sha" ]`) takes the **wrong branch** -- "missing"
  is now indistinguishable from "found".
- Interpolated into a JSON body it produces invalid JSON: a loud 400, which is
  the lucky outcome.
- Passed as a form field to a **forgiving** endpoint it can be accepted. The
  GitHub contents API ignores a bogus `sha` when creating a new file, so a
  helper sent the 404 blob as the sha on every create and looked perfectly
  healthy -- until the value had to be valid JSON and the latent bug surfaced
  years later as somebody else's parse error.

## WRONG

```sh
# Reads as "the sha, or empty if the file does not exist". It is not.
sha="$(gh api "repos/${repo}/contents/${path}" --jq .sha 2>/dev/null || true)"

if [ -n "$sha" ]; then
    # Taken on a 404: $sha is the error JSON, not a sha.
    args+=(-f "sha=${sha}")
fi
```

## RIGHT

```sh
# Option A -- branch on the exit code, and keep stdout only on success.
if sha="$(gh api "repos/${repo}/contents/${path}" --jq .sha 2>/dev/null)"; then
    :            # $sha is a real blob sha
else
    sha=""       # any error, including 404 "not there yet"
fi

# Option B -- validate the SHAPE, which also catches an empty or partial read.
# Belt and braces when the value flows into a request body.
sha="$(gh api "repos/${repo}/contents/${path}" --jq .sha 2>/dev/null || true)"
if [[ ! $sha =~ ^[0-9a-f]{40}$ && ! $sha =~ ^[0-9a-f]{64}$ ]]; then
    sha=""
fi
```

## NOTES

- **`|| true` is the actual trap**, not `gh`. It converts "this failed" into
  "this succeeded with whatever was on stdout". Reach for it only when you have
  already dealt with stdout -- pair it with `--silent`, or with a shape check.
- `--silent` suppresses the response body on stdout for both success and error,
  so `gh api ... --silent` plus the exit code is the cleanest probe when you
  only want to know **whether** something exists.
- The same shape holds for any CLI that prints a machine-readable error payload
  on stdout and reserves stderr for human text -- increasingly common, because
  the payload is considered output. Do not assume "errors go to stderr".
- Accept 64-hex as well as 40-hex if the value is a git object id: SHA-256
  repositories produce the longer form.
- Related, same family of "the check passed because the checker returned
  nothing useful": [comm silent empty output](comm-silent-empty-output-git-bash.md)
  and [command -v finds a non-executing stub](command-v-finds-nonexecuting-stub.md).
