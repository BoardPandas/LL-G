---
tech: doppler
tags: [doppler, secrets, cli, set, stdout, secret-leak, no-interactive]
severity: medium
---
# doppler secrets set prints the values it set

## PROBLEM
`doppler secrets set` prints a table that includes the value it just wrote, even when the value arrives on stdin rather than on the command line. Running it in a script, a CI log, or an agent transcript therefore leaks the secret. Piping the value in avoids shell history and argv exposure, but does not stop the echo.

## WRONG
```bash
doppler secrets set API_TOKEN -p roundtable -c prd --no-interactive <<< "$token"
# prints a table containing the value of API_TOKEN
```

## RIGHT
```bash
printf %s "$token" | doppler secrets set API_TOKEN -p roundtable -c prd --no-interactive >/dev/null
doppler secrets --only-names -p roundtable -c prd
```

## NOTES
Discard stdout on every `set`, and check the exit status rather than the output. Use `--only-names` for any listing that is shown or logged. `printf %s` avoids adding a trailing newline to the value. Related: the rename entry in this shelf needs the value to pass through the same discarded pipe.
