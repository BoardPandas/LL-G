---
tech: bash
tags: [msys, git-bash, windows, jq, path-conversion, native-binary, silent-failure, generated-json]
severity: high
---
# `MSYS_NO_PATHCONV=1` fixes `jq --arg` but breaks `jq`'s own file arguments, because jq is a native Windows binary

## PROBLEM

The documented fix for `msys-path-conversion-corrupts-jq-arg.md` is
`export MSYS_NO_PATHCONV=1`. That is correct for `--arg` values, and it introduces a
second failure in the same command: path conversion is what lets a **native Windows**
binary accept an MSYS-style `/c/Users/...` path at all.

With conversion on, Git Bash rewrites `/c/Users/foo/x.tsv` into `C:/Users/foo/x.tsv`
before `jq.exe` sees it. With `MSYS_NO_PATHCONV=1` it passes `/c/Users/foo/x.tsv`
verbatim, and `jq.exe` -- which knows nothing about the MSYS root -- cannot open it.

The failure is confusing enough to send you after the wrong hypothesis, because **MSYS
builtins and MSYS-compiled utilities still read the same path fine**. In one session:

    cat "$D/fetch.tsv"     # prints 4 rows -- the file plainly exists
    jq -R -s ... "$D/fetch.tsv"
    # jq: error: Could not open file /c/Users/.../fetch.tsv: No such file or directory

`cat` (MSYS) succeeds and `jq` (native) fails **on the same string in the same shell**,
which reads as "jq is broken" rather than "the path is in the wrong dialect".

It fails toward silence, not toward an obvious stop. `jq` writes its diagnostic to
stderr and exits non-zero, but in a pipeline that redirects to a file, the downstream
artifact is created **empty and well-formed**: `{"requests":[]}`. Any later step that
counts or iterates it reports zero without erroring. If that artifact is a batch of
API mutations, "zero" is indistinguishable from "nothing to do", and the run proceeds
looking clean.

The whole trap is that both directions are real: leave conversion on and your `--arg`
values are corrupted; turn it off and your file arguments are. Neither setting is
globally safe, so the mitigation cannot be a setting.

## WRONG

```bash
export MSYS_NO_PATHCONV=1          # correct for --arg, fatal for file args
D="/c/Users/me/scratch"

jq -R -s --arg mb 'users/x/messages' '
  {requests: [ split("\n")[] | select(length>0) | split("\t") |
    {id: .[0], url: ("/" + $mb + "/" + .[1])} ]}' "$D/rows.tsv" > "$D/batch.json"
# jq: error: Could not open file /c/Users/me/scratch/rows.tsv  (stderr, easily lost)

jq '.requests|length' "$D/batch.json"   # 0 -- reads as "nothing to do"
```

## RIGHT

```bash
export MSYS_NO_PATHCONV=1          # keep it: --arg values still need protecting
cd "/c/Users/me/scratch" || exit 1  # then pass BARE filenames -- no leading slash,
                                    # so no conversion is needed in either direction

jq -R -s --arg mb 'users/x/messages' '
  {requests: [ split("\n")[] | select(length>0) | split("\t") |
    {id: .[0], url: ("/" + $mb + "/" + .[1])} ]}' rows.tsv > batch.json

# Prove the generated artifact, not the source data:
test "$(jq '.requests|length' batch.json)" -eq "$(wc -l < rows.tsv)" || exit 1
jq -r '.requests[0].url' batch.json | cut -c1-40     # expect /users/x/messages/...
```

Equivalent if you cannot `cd`: convert explicitly for the native binary with
`jq ... "$(cygpath -m "$D/rows.tsv")"`, which is correct under both settings.

## NOTES

Companion to `msys-path-conversion-corrupts-jq-arg.md` -- **that entry's remedy is this
entry's cause**, so they must be read together. `cd` + bare filenames is the one form
that is correct with conversion on *or* off, which is why it beats toggling the variable.

Applies to any native Windows binary invoked from Git Bash, not just `jq`: `python.exe`,
`node.exe`, `gh.exe` and friends all take Windows paths. The asymmetry with `cat`, `grep`
and `wc` (MSYS-compiled, accept both) is what makes it read as a per-tool bug.

Detection is the general rule from `comm-silent-empty-output-git-bash.md`: pair every
should-be-zero check with a control that must be NON-zero. Here the control was
"ids re-extracted from the generated body that match the source TSV -- want 4", and it
read 0 alongside the leak checks. A broken-data hypothesis cannot explain a should-be-4
and a should-be-0 both reading 0; a broken-generator hypothesis explains both. That is
what caught it before anything was sent.

Do not verify by re-reading the source `.tsv` -- it is fine. Verify by extracting values
back OUT of the generated JSON and diffing them against the source, per the companion entry.
