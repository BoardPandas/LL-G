---
tech: bash
tags: [msys, git-bash, windows, jq, path-conversion, json-generation, api, silent-failure, crlf]
severity: high
---
# MSYS path conversion rewrites a leading-slash `jq --arg` value into a Windows path, corrupting every URL inside generated JSON

## PROBLEM

Git Bash / MSYS2 on Windows rewrites arguments that *look* like POSIX paths into Windows paths before the program sees them. This is normally helpful for real filesystem paths, but it fires on **any** argument starting with `/`, including API path prefixes, URL paths, and JSON Pointer strings you are passing as data.

Passing an API path to `jq` as a variable:

```bash
jq --arg mb "/users/chaz@example.com/messages" ...
```

hands `jq` the value `C:/Program Files/Git/users/chaz@example.com/messages`. `jq` runs fine, the JSON is well-formed, the exit code is 0, and the file looks plausible at a glance. Every URL built from that variable is silently wrong:

```json
{ "url": "C:/Program Files/Git/users/chaz@example.com/messages/AAMk.../move" }
```

This is a **generation-time** corruption, which is what makes it nasty. Validating your *source* data passes -- the ids, the classification, the counts are all correct. The corruption lives only inside the generated artifact. If the endpoint is a batch API, you either get a wall of opaque per-item failures or, worse, a partially-applied batch.

The tell is the same one that shows up in the sibling entry `comm-silent-empty-output-git-bash.md`: a readback that extracts values back out of the *generated* file matches nothing, because the prefix-stripping pattern no longer matches. Silence from that readback means the check is broken **or** the generation is broken -- both demand a stop.

Related, same platform, same class of quiet damage: the Claude Code Bash tool writes heredocs with **CRLF** line endings on Windows, so a `cat > file <<'EOF'` data file carries a trailing `\r` on every line. `tr -d '\r'` it before parsing, or trailing fields silently gain a carriage return.

## WRONG

```bash
# MSYS rewrites the leading-slash value; every generated URL is prefixed with the Git install path.
awk -F'\t' '$1=="arch"{print $3}' items.tsv \
  | jq -R -s --arg mb "/users/chaz@example.com/messages" '
      {requests: (split("\n") | map(select(length>0)) | to_entries | map({
        id: ((.key+1)|tostring),
        method: "POST",
        url: ($mb + "/" + .value + "/move")
      }))}' > batch.json

# batch.json now contains "C:/Program Files/Git/users/..." in every url. jq exited 0.
```

## RIGHT

```bash
# Option A -- disable path conversion for the call.
export MSYS_NO_PATHCONV=1

awk -F'\t' '$1=="arch"{print $3}' items.tsv \
  | jq -R -s --arg mb "/users/chaz@example.com/messages" '
      {requests: (...)}' > batch.json

# Option B -- never pass a leading slash across the process boundary; prepend it inside jq.
awk -F'\t' '$1=="arch"{print $3}' items.tsv \
  | jq -R -s --arg mb "users/chaz@example.com/messages" '
      {requests: (split("\n") | map(select(length>0)) | to_entries | map({
        id: ((.key+1)|tostring),
        method: "POST",
        url: ("/" + $mb + "/" + .value + "/move")
      }))}' > batch.json

# Either way, VERIFY THE GENERATED ARTIFACT, not just the source data:
jq -r '.requests[0].url' batch.json | grep -q '^/users/' \
  || { echo "FAIL: generated URLs have a corrupted prefix" >&2; exit 1; }

# And round-trip the ids back OUT of the generated file, with a control that must be non-zero:
jq -r '.requests[].url | sub("^.*/messages/";"") | sub("/move$";"")' batch.json > /tmp/gen.txt
expected=$(awk -F'\t' '$1=="arch"' items.tsv | wc -l)
matched=$(grep -F -x -f <(awk -F'\t' '$1=="arch"{print $3}' items.tsv) /tmp/gen.txt | wc -l)
[ "$matched" -eq "$expected" ] || { echo "FAIL: id round-trip $matched != $expected" >&2; exit 1; }
```

## NOTES

- Discovered 2026-08-04 generating a Microsoft Graph `$batch` body: all 50 sub-request URLs carried the `C:/Program Files/Git/` prefix. Caught before sending, by an id readback that printed nothing.
- `MSYS_NO_PATHCONV=1` is the Git-for-Windows spelling; `MSYS2_ARG_CONV_EXCL='*'` is the MSYS2 equivalent. Both are per-process env vars -- export them before the call, not inside a subshell that ends first.
- Conversion triggers on the argument's *shape*, not on the receiving program. It hits `curl -d '/path'`, `docker run -v`, `git -c`, and any tool taking a JSON Pointer (`/foo/bar`) just as readily as `jq --arg`.
- A double slash (`//users/...`) is the traditional escape hatch, but it leaves a literal `//` in your data unless the receiver normalizes it -- prefer the env var or the prepend-inside-jq form.
- Generating batch bodies mechanically (classify to a TSV, let `jq` emit the request array) is still the right call -- it eliminates hand-transcription id slips entirely. The lesson is that mechanical generation moves the risk from transcription to *generation*, so the verification has to read back out of the generated artifact rather than re-checking the source.
