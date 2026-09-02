---
tech: powershell
tags: [Invoke-RestMethod, return, arrays, @(), member-enumeration, StrictMode]
severity: high
---
# Returning an Invoke-RestMethod JSON array from a function and wrapping the call in @() nests it

## PROBLEM
`Invoke-RestMethod` hands a JSON array back as a single `Object[]` object. When a wrapper function does `return Invoke-RestMethod ...` (or `return $result`), the function emits that array as ONE pipeline item. A caller that writes `@(Invoke-Ninja ...)` then gets a one-element array whose element is the whole `Object[]`. `foreach` runs once with the entire array as the loop variable, and `$o.id` member-enumerates to an array of every id. Under a cast that is a loud error (`Cannot convert "System.Object[]" to "System.Int32"`); without a cast it is silently wrong (a hashtable keyed by an array, a string containing every id concatenated).

Verified 2026-09-02 (pwsh 7): `$x = Invoke-Ninja ...` gives `Object[]` count 22, but `@(Invoke-Ninja ...)` gives count 1 with `[0]` of type `Object[]`.

## WRONG
```powershell
function Invoke-Ninja { param($Path) return Invoke-RestMethod -Uri "$base$Path" -Headers $h }

foreach ($o in @(Invoke-Ninja '/organizations')) {   # one iteration, $o is the whole array
    $orgName[[int]$o.id] = $o.name                     # "Cannot convert System.Object[] to Int32"
}
```

## RIGHT
```powershell
function Invoke-Ninja {
    param($Path)
    $result = Invoke-RestMethod -Uri "$base$Path" -Headers $h
    if ($result -is [array]) { foreach ($item in $result) { Write-Output -InputObject $item } }
    else { Write-Output -InputObject $result }
}

foreach ($o in @(Invoke-Ninja '/organizations')) { $orgName[[int]$o.id] = $o.name }   # 22 iterations
```
Alternatively assign first and wrap second: `$orgs = Invoke-Ninja '/organizations'; foreach ($o in @($orgs)) { ... }` also gives a flat array.

## NOTES
- This is the mirror image of the `return ,$arr` collapse entry (comma-return-collapse.md). There the comma was the culprit; here the raw array object is. Both end with a 1-tuple wrapping the real data.
- The nesting is invisible in preview output (`Format-Table` still prints the rows), so test with `@(...).Count` and `[0].GetType()`.
- Single-object JSON responses (an object with an `activities` property, a device record) are unaffected; only top-level JSON arrays hit this.
