---
tech: bash
tags: [curl, secrets, argv, ps, tokens, process-substitution]
severity: high
---
# `curl -H "Authorization: Bearer $TOKEN"` shows the token to every user through `ps`

## PROBLEM
Every argument of a running process is world-readable on Linux (`ps aux`, `/proc/<pid>/cmdline`). A header passed with `-H` puts the bearer token, an Access client secret or an API key on the command line for as long as curl runs. A hook that runs on every prompt keeps that window open all day on a shared machine. Nothing logs or warns about it.

## WRONG
```bash
curl -s -H "Authorization: Bearer $TOKEN" -H "CF-Access-Client-Secret: $SECRET" "$URL"
```

## RIGHT
```bash
# The config arrives through a pipe; argv shows only /dev/fd/63.
curl -s -K <(
  printf 'header = "Authorization: Bearer %s"\n' "$TOKEN"
  printf 'header = "CF-Access-Client-Secret: %s"\n' "$SECRET"
) --data-binary @<(printf '%s' "$body") "$URL"
```

## NOTES
Validate each value against a strict character set first (for example `^[A-Za-z0-9._-]+$`). A quote or newline in a value can end or extend the config line. `printf` is a bash builtin, so the values never reach an exec either. The same holds for a request body that holds secrets: send it with `--data-binary @<(...)`, not `-d "$body"`. Found in Roundtable's `rt` CLI (2026-10-15).
