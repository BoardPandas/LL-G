---
tech: bash
tags: [jq, tsv, read, ifs, paths, parsing]
severity: high
---
# jq `@tsv` escapes backslashes, so a path read back from it no longer names the directory

## PROBLEM
Splitting several JSON fields into shell variables with `@tsv` and `IFS=$'\t' read` looks lossless, but `@tsv` escapes `\`, tab, newline and CR (`\` becomes `\\`). A path holding a backslash (any Windows-style path, or a POSIX name that contains one) comes back with doubled backslashes, so `git -C "$dir"` or `cd "$dir"` targets a directory that does not exist. Nothing errors: the hook concludes "not a git repo" and quietly does nothing. A second trap: tab is IFS whitespace, so `read` collapses consecutive tabs and an empty middle field shifts every later field left.

## WRONG
```bash
IFS=$'\t' read -r sid dir n < <(jq -r '[.session_id, .cwd, .n] | @tsv' <<<"$payload")
```

## RIGHT
```bash
# The unit separator never appears in a path or id, is not IFS whitespace (empty fields survive), and jq does not rewrite it.
fields="$(jq -r '[.session_id, .cwd, .n] | map(tostring) | join("\u001f")' <<<"$payload")"
IFS=$'\x1f' read -r sid dir n <<<"$fields"
```

## NOTES
Found building Roundtable's `rt hook` (2026-10-15). `@csv` quotes instead, which is just as wrong for `read`. For a single field, `jq -r .cwd` alone is exact.
