---
tech: gcloud
tags: [gcloud, google-cloud, windows, git-bash, crlf, carriage-return, word-splitting, iam, silent-failure]
severity: high
---
# gcloud value() output on Windows ends in CRLF, so every looped ID but the last fails with "INVALID_ARGUMENT: Unknown error"

## PROBLEM
On Windows, gcloud (a native Python program) ends each `--format="value(...)"` line with `\r\n`. In Git
Bash, `$(...)` strips only the final newline, and word splitting splits on `\n`. So every item but the
last keeps a trailing `\r`. Passing `name\r` to the next gcloud call gives an opaque API error, such as
`ERROR: (gcloud.iam.service-accounts.keys.list) INVALID_ARGUMENT: Unknown error`. It does not mention
the bad character, because `\r` is invisible in the echoed argument.

The last item has no `\r` and succeeds. A 16-item loop that fails 15 times and works once looks like a
per-resource permission or data problem, not a shell bug. With `2>&1` folded into a report, the loop
can also produce a table of errors that reads like real results.

## WRONG
```bash
for sa in $(gcloud iam service-accounts list --project "$P" --format="value(email)"); do
  gcloud iam service-accounts keys list --iam-account "$sa"
done
# 15x: INVALID_ARGUMENT: Unknown error   1x: (keys of the last account)
```

## RIGHT
```bash
for sa in $(gcloud iam service-accounts list --project "$P" --format="value(email)" </dev/null | tr -d '\r'); do
  gcloud iam service-accounts keys list --iam-account "$sa" </dev/null
done
```

## NOTES
- Strip `\r` from any gcloud output that feeds an argument, a comparison, or a file you will diff.
  `--format=json` piped to jq avoids the problem for structured reads.
- The `</dev/null` on the inner command keeps gcloud from reading the loop's stdin (see the bash entry on
  commands inside `while read` loops).
- Detection: if only the LAST item of a loop succeeds, suspect a trailing `\r` before suspecting
  permissions.
