---
tech: powershell
tags: [arrays, pipeline, scalar, type-safety]
severity: high
---
# Array safety with @() wrapping

## PROBLEM
PowerShell automatically unwraps single-item pipeline results into a scalar (non-array). Code that iterates or calls `.Count` on the result works correctly with 2+ items but silently breaks with exactly 1 item -- or 0 items returns `$null` instead of an empty array.

## WRONG
```powershell
$users = Get-MgUser -Filter "department eq 'IT'"
# If exactly 1 user: $users is a single object, not an array
# $users.Count works by accident (scalar objects have a Count of 1)
# but $users[0] returns the first CHARACTER of the string representation
foreach ($user in $users) { ... }  # works, but fragile
```

## RIGHT
```powershell
$users = @(Get-MgUser -Filter "department eq 'IT'")
# Now $users is always an array: 0, 1, or many items
# $users.Count is reliable
# $users[0] is the first user object
foreach ($user in $users) { ... }  # safe
```

## NOTES
- Affects any cmdlet that returns pipeline output: `Get-*`, `Where-Object`, `Select-Object`, etc.
- `@()` is zero-cost when the result is already an array -- safe to use always
- An empty result without `@()` returns `$null`; with `@()` it returns an empty array `@()`, making null checks unnecessary
- Particularly common failure pattern with Graph API cmdlets, AD cmdlets, and WMI queries
- Under `Set-StrictMode -Version Latest`, accessing `.Property` on a `$null` object also throws. Null-check the object before accessing properties: `if ($obj) { $value = $obj.Property }`
