---
tech: powershell
tags: [windows, query-exe, sessions, erroractionpreference, scheduled-tasks, polling]
severity: high
---
# query.exe user polling aborts when no session exists

## PROBLEM
With `$ErrorActionPreference = 'Stop'`, Windows PowerShell 5.1 can turn `query.exe user` stderr into a terminating `NativeCommandError`. When no interactive user exists, `query.exe` writes `No User exists for *` and exits 1. Even `2>$null` does not make the call safe, so a boot-time verifier that is supposed to wait for a login can exit immediately with code 1 instead.

This is especially deceptive in scheduled-task and reboot tests because the same script passes whenever login timing happens to put a user session in place before the poll starts.

## WRONG
```powershell
$ErrorActionPreference = 'Stop'

function Get-ActiveTargetSession {
  $lines = @(& query.exe user 2>$null)
  foreach ($line in $lines) {
    if ([string]$line -match '^\s*C4adUser\s+\S+\s+(\d+)\s+Active\b') {
      return [int]$Matches[1]
    }
  }
  return 0
}
```

## RIGHT
```powershell
$ErrorActionPreference = 'Stop'

function Get-ActiveTargetSession {
  $lines = @()
  $queryExitCode = 0
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'SilentlyContinue'
    $lines = @(& query.exe user 2>$null | ForEach-Object { [string]$_ })
    $queryExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  foreach ($line in $lines) {
    $clean = $line.TrimStart('>')
    if ($clean -match '^\s*C4adUser\s+\S+\s+(\d+)\s+Active\b') {
      return [int]$Matches[1]
    }
  }

  # Exit 1 can mean either no session or valid output on some systems.
  # Parse the rows first, then treat an absent target row as "not ready yet."
  return 0
}
```

## NOTES
Use a bounded outer wait with explicit timeout evidence. Do not fail solely on `$LASTEXITCODE`: `query.exe` can also return 1 while printing a valid session table. For reboot acceptance, separately provision and verify that the intended test account will actually log in; a safe poll prevents a false failure but cannot create a session.
