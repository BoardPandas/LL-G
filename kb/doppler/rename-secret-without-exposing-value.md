---
tech: doppler
tags: [doppler, secrets, cli, rename]
severity: medium
---
# Renaming a Doppler secret without exposing its value

## PROBLEM
Doppler's API rename (`change_requests` with `originalName` and `name`) requires `value`, so an agent or script that renames through the API has to read the secret into its context or logs. The CLI has no rename command. `doppler secrets set` and `delete` also print a table with values unless their output is discarded.

## WRONG
```bash
# API rename: value is a required field, so the secret must be read first
doppler secrets get OLD --plain        # prints the value into the transcript/log
```

## RIGHT
```bash
P=(--project plex --config prd)
printf '%s' "$(doppler secrets get OLD --plain --raw "${P[@]}")" \
  | doppler secrets set NEW --no-interactive "${P[@]}" >/dev/null 2>&1
if cmp -s <(doppler secrets get OLD --plain --raw "${P[@]}") <(doppler secrets get NEW --plain --raw "${P[@]}"); then
  doppler secrets delete OLD --yes "${P[@]}" >/dev/null 2>&1
fi
```

## NOTES
The printf/command substitution avoids storing a trailing newline; the cmp guard means the old name is deleted only after a byte-identical copy exists. The audit log records a set and a delete rather than a rename.
