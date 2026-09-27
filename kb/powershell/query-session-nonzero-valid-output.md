---
tech: powershell
tags: [windows, query.exe, terminal-services, exit-code, session-validation]
severity: medium
---
# query.exe session can return exit code 1 with valid output

## PROBLEM

On some Windows hosts, `query.exe session` prints a complete session table with
the expected active console row but still sets `$LASTEXITCODE` to 1. A preflight
that requires both a matching row and exit code 0 rejects a valid target even
though the command returned the data needed for the safety check.

## WRONG

```powershell
$sessionLines = @(& "$env:SystemRoot\System32\query.exe" session 2>&1)
$sessionText = $sessionLines -join [Environment]::NewLine
if ($LASTEXITCODE -ne 0 -or
    $sessionText -notmatch '(?im)^\s*>?\s*console\s+B_StL\s+1\s+Active\b') {
    throw 'Approved active console session missing'
}
```

## RIGHT

```powershell
$sessionLines = @(& "$env:SystemRoot\System32\query.exe" session 2>&1)
$queryExit = $LASTEXITCODE
$sessionText = $sessionLines -join [Environment]::NewLine

$expectedRow = '(?im)^\s*>?\s*console\s+B_StL\s+1\s+Active\b'
if ($sessionText -notmatch $expectedRow) {
    throw "Approved active console session missing; query exit $queryExit"
}
```

## NOTES

Keep the hostname, account, session number and state pinned separately. Treat the
utility exit code as diagnostic when the expected row is present. If output
parsing cannot be made locale-safe, use the Windows Terminal Services API instead
of weakening the identity check.

