---
tech: go
tags: [macos, softwareupdate, parsing, patching, native-fixtures]
severity: high
---
# Parse observed softwareupdate history rather than invented status columns

## PROBLEM

On macOS 26.6.2, `LC_ALL=C /usr/sbin/softwareupdate --history` returns Display Name, Version and Date columns, with no Status column. A synthetic fixture with an extra Installed column lets tests pass while the real collector labels every installed update unknown. Searching status text for the substring `install` also marks `Install failed` as installed.

## WRONG

```go
status := columns[3] // invented by the fixture, absent from this native format
installed := strings.Contains(strings.ToLower(status), "install")
```

## RIGHT

```go
// Establish the supported header shape before interpreting a missing status.
completedHistory := headerHasExactly("Display Name", "Version", "Date")
installed := validDate && ((completedHistory && status == "") ||
    strings.EqualFold(strings.TrimSpace(status), "installed"))
```

Use recorded native output as a regression fixture, including the date format `01/02/2006, 15:04:05` in the endpoint's local timezone. Also test explicit failed statuses, unknown headers, missing update details and truncated output. Empty output or a vanished update label alone never proves installation. Execution verification should require exact title/version history plus a successful fresh available-update scan, and a changed boot identity when restart is required.

## NOTES

Observed with a read-only scan on macOS 26.6.2 build 25G83, 2026-09-08. This observation does not establish every macOS release's history format. Native macOS 15 and pending-update acceptance remain separate evidence requirements. Portable parser regressions belong in an untagged Go test file; opt-in native collection belongs in a Darwin-only test.
