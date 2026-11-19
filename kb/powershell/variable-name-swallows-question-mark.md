---
tech: powershell
tags: [powershell, string-interpolation, variable-names, url, rest]
severity: medium
---
# "$var?query" reads a variable named var?query

## PROBLEM
PowerShell variable names in double-quoted strings may contain `?`, so `"$site?api-version=x"`
expands `$site?api` (and stops at `-`). Without StrictMode that variable is empty, so the URL
silently loses its whole path and the call hits the wrong resource, often with a confusing
200 or blank output rather than an error.

## WRONG
```powershell
$r = Invoke-AzRestMethod -Method GET -Path "$site?api-version=2023-12-01"
```

## RIGHT
```powershell
$r = Invoke-AzRestMethod -Method GET -Path "${site}?api-version=2023-12-01"
```

## NOTES
`Set-StrictMode -Version Latest` turns the silent empty expansion into an error.
