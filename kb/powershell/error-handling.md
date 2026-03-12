---
tech: powershell
tags: [error-handling, exceptions, ErrorAction, try-catch]
severity: high
---
# Error handling with -ErrorAction Stop

## PROBLEM
PowerShell's default `$ErrorActionPreference` is `Continue`, meaning non-terminating errors are printed to the console but execution continues. A cmdlet can fail silently and the script will keep running with bad state. Without `try/catch`, errors are never caught.

## WRONG
```powershell
# No error preference set -- errors are swallowed
Get-Item "C:\nonexistent\path"  # prints error, continues
$result = Get-Item "C:\nonexistent\path"
# $result is $null, but script keeps running with no exception thrown
```

## RIGHT
```powershell
$ErrorActionPreference = 'Stop'  # at the top of every script

try {
    $result = Get-Item "C:\nonexistent\path"
    # ... use $result
}
catch {
    Write-Error "Failed: $_"
    # handle or rethrow
}
finally {
    # cleanup always runs (close connections, remove temp files, etc.)
    Disconnect-MgGraph -ErrorAction SilentlyContinue
}
```

## NOTES
- `-ErrorAction Stop` on individual cmdlets promotes that call's errors to terminating -- useful when you don't want to set the global preference
- `$ErrorActionPreference = 'Stop'` at the script top is preferred for whole-script safety
- `$_` inside `catch` is the `ErrorRecord` object; `$_.Exception.Message` gives the message string
- Always use `finally` blocks for resource cleanup (open sessions, temp files, database connections)
- `SilentlyContinue` is valid for cleanup in `finally` where you don't care if it fails
- Operations inside `catch` blocks can also fail. Use nested try/catch for recovery operations:
  ```powershell
  try {
      $sp = New-MgServicePrincipal -AppId $appId
  } catch {
      if ($_.Exception.Message -match "already exists") {
          try {
              $sp = Get-MgServicePrincipal -Filter "appId eq '$appId'"
          } catch {
              Write-Error "Could not create or find service principal: $($_.Exception.Message)"
              exit 1
          }
      } else { throw }
  }
  ```
