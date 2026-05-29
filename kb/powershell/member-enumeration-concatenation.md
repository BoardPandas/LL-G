---
tech: powershell
tags: [arrays, member-enumeration, string-formatting, strictmode, foreach]
severity: high
---
# Member enumeration on an array returns every element's value (silent concatenation)

## PROBLEM
Accessing a property on an array (PowerShell "member enumeration") returns an array of that property from EVERY element, not a single value. Inside a double-quoted string, `-f` format, or `Write-Host`, that array is stringified by joining all elements with a space, producing one corrupted value that looks like a single field. The symptom is baffling: an org/device "name" that is actually every org's name concatenated, or a `foreach` that appears to run once but iterates the whole collection.

## WRONG
```powershell
$orgs = Invoke-RestMethod -Uri "$base/organizations" -Headers $h
Write-Host "First org: $($orgs.name)"     # prints ALL org names joined together
$id = ("{0}" -f $orgs.id)                  # all ids concatenated
```

## RIGHT
```powershell
foreach ($o in @($orgs)) {
    Write-Host ("Org {0}: {1}" -f $o.id, $o.name)   # one element at a time
    $tags = if ($o.PSObject.Properties['tags']) { $o.tags } else { @() }  # guard optional props
}
```

## NOTES
- Pair with the `@()` array-safety habit: wrap pipeline results in `@()` so single items are still arrays, then iterate with `foreach`.
- Under `Set-StrictMode -Version Latest`, accessing a property that does not exist on some elements throws; guard with `$obj.PSObject.Properties['name']` before access.
- Common with REST APIs that return arrays of objects (Meraki `/organizations`, NinjaOne queries, Graph `value`).
