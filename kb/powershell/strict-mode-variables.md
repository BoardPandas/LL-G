---
tech: powershell
tags: [strictmode, variables, initialization, conditional-branches, set-strictmode]
severity: high
---
# Initialize variables before conditional branches under StrictMode

## PROBLEM
Under `Set-StrictMode -Version Latest`, accessing a variable that has never been assigned throws an error -- even if the variable was supposed to be set in a previous `if` branch that didn't execute. This is a common source of "variable not set" crashes when a condition is false.

## WRONG
```powershell
Set-StrictMode -Version Latest

# BAD -- $result is never set if $someCondition is false
if ($someCondition) {
    $result = Get-Something
}
if (-not $result) { ... }  # Crash: "variable $result is not set"

# BAD -- renaming a parameter without updating all references
# If you rename -Domain to -TenantDomain, every $Domain reference crashes
```

## RIGHT
```powershell
# GOOD -- initialize before any conditional branch
$result = $null
if ($someCondition) {
    $result = Get-Something
}
if (-not $result) { ... }  # Safe -- $result is $null, not unset

# After renaming parameters, search for all old references:
# grep -n '$OldParamName' script.ps1
```

## NOTES
- Always initialize to a safe default: `$null` for objects, `@()` for arrays, `''` for strings, `0` for integers.
- StrictMode also catches property access on null objects: if `$obj` is `$null`, `$obj.Property` throws. Null-check first.
- `Set-StrictMode -Version Latest` is the recommended level -- it catches the most issues at the cost of more discipline.
