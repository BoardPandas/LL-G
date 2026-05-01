---
tech: powershell
tags: [arrays, return, comma-operator, function]
severity: high
---
# Comma-wrap return on a >1 element array collapses to 1 element when caller does @()

## PROBLEM
The pattern `return ,$array` is commonly used to prevent PowerShell's auto-unrolling of single-element arrays. But when the function returns a multi-element array AND the caller wraps the call in `@(...)`, the comma wrap causes the entire array to be treated as a single element. The caller ends up with `Count = 1` and the inner array as element 0. Iteration logic that expects N items silently processes 1.

## WRONG
```powershell
function Get-Items {
    $list = New-Object System.Collections.Generic.List[object]
    1..50 | ForEach-Object { $list.Add($_) }
    return ,$list.ToArray()   # comma wraps 50-element array as outer 1-tuple
}

$items = @(Get-Items)
$items.Count   # 1, not 50
$items[0].Count  # 50 -- the array got nested
```

## RIGHT
```powershell
function Get-Items {
    $list = New-Object System.Collections.Generic.List[object]
    1..50 | ForEach-Object { $list.Add($_) }
    return $list.ToArray()   # PS auto-enumerates multi-element arrays in pipeline
}

$items = @(Get-Items)
$items.Count   # 50
```

## NOTES
- The comma trick (`return ,$x`) is only correct when you need to PREVENT the unrolling of a single-element or empty array AND the caller does NOT re-wrap with `@()`.
- If the caller is `@(Get-Items)`, you do not need the comma — `@()` already restores array shape regardless of unrolling.
- Symptom in the wild: a paginated function appears to fetch every page successfully (debug logs show List.Count climbing into the hundreds), then the caller reports only 1 item.
- If you must prevent unrolling AND know callers may not re-wrap, use a `[System.Collections.IList]` return type or have the function emit elements directly without the comma: just `$list.ToArray()` on its own line at end of function works in nearly all cases.
- This bites paginated Graph API helpers especially hard, because the symptom looks like the API only returned one page.
