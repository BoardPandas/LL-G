---
tech: graph-api
tags: [conditional-access, ca-policy, patch, powershell, 1007, schema, json, arrays]
severity: high
---
# CA policy PATCH fails with 1007: strip null fields and keep arrays array-shaped

## PROBLEM
PATCHing `/identity/conditionalAccess/policies/{id}` you must send the full `conditions` object so you don't wipe sibling fields (see ca-policy-patch.md). But two subtle issues both produce the same opaque error:

`400 BadRequest` / `"1007: Incoming ConditionalAccessPolicy object is null or does not match the schema of ConditionalAccessPolicy type."`

1. **Null complex sub-fields.** If you echo the `conditions` object back verbatim from the GET, its `null`-valued complex properties fail schema validation on write. Observed offenders: `conditions.locations`, `conditions.platforms`, `conditions.devices`, `conditions.clientApplications`, `conditions.authenticationFlows`, `conditions.insiderRiskLevels`, and inside `conditions.users` the `includeGuestsOrExternalUsers` / `excludeGuestsOrExternalUsers`. Empty arrays (`[]`) are fine; only `null`s break it.

2. **PowerShell unwraps single-element arrays into scalars.** Building the body in PowerShell, a one-element list serializes as `"includeApplications": "All"` instead of `["All"]`, which also yields 1007. Two distinct triggers: (a) `return @(...)` from a function unwraps a single-element array to a scalar; (b) assigning a one-element list to a hashtable property loses array-ness through `ConvertTo-Json`.

The error message names neither cause, so it is easy to thrash on.

## WRONG
```powershell
# Echoes nulls back AND lets single-element arrays collapse to scalars
$p = Invoke-MgGraphRequest GET ".../policies/$id"
$conditions = $p.conditions                       # still contains null locations/platforms/devices/etc.
$conditions.applications.excludeApplications = @($vmAppId)   # 1-element -> serializes as "id" not ["id"]
$body = @{ conditions = $conditions } | ConvertTo-Json -Depth 15
Invoke-MgGraphRequest PATCH ".../policies/$id" -Body $body   # 400 / 1007

# And a "cleaner" function that still corrupts shape:
function Clean($n) { ... return @($n | % { Clean $_ }) }      # return unwraps @("All") -> "All"
```

## RIGHT
```powershell
# Recursively drop @odata.* AND null-valued keys; preserve array-ness with the unary comma on RETURN
function Clean-Node($node) {
    if ($node -is [System.Collections.IDictionary]) {
        $h = @{}
        foreach ($k in $node.Keys) {
            if ($k -like "@odata*") { continue }
            if ($null -eq $node[$k]) { continue }     # strip nulls -> fixes cause #1
            $h[$k] = Clean-Node $node[$k]
        }
        return $h
    } elseif ($node -is [System.Collections.IEnumerable] -and -not ($node -is [string])) {
        return ,@($node | ForEach-Object { Clean-Node $_ })   # unary comma -> keeps 1-elem array (cause #2a)
    } else {
        return $node
    }
}

$p = Invoke-MgGraphRequest GET ".../policies/$id"
$conditions = Clean-Node $p.conditions
$excl = @($conditions.applications.excludeApplications)
if ($excl -notcontains $vmAppId) { $excl += $vmAppId }
$conditions.applications.excludeApplications = [string[]]@($excl)   # typed-array cast (cause #2b)
# NOTE: do NOT use ,@($excl) here -- the comma double-wraps into [["id"]], also rejected.

$body = @{ conditions = $conditions } | ConvertTo-Json -Depth 15
Invoke-MgGraphRequest PATCH ".../policies/$id" -Body $body -ContentType "application/json"
```

## NOTES
- Rule of thumb: **unary comma `,@(...)` for function returns; `[string[]]` cast for hashtable assignments.** Mixing them up either collapses (`"All"`) or double-wraps (`[["id"]]`) the array; both fail 1007.
- Read-replica lag: an immediate GET after a successful PATCH can show the change absent. Re-read after ~10s before concluding the write failed.
- Writing CA policies needs `Policy.ReadWrite.ConditionalAccess` (reading needs `Policy.Read.All`); standard registrations have neither (see conditional-access.md). Don't omit fields you mean to keep (see ca-policy-patch.md).
- Discovered 2026-05-28 excluding Azure Windows VM Sign-In (`372140e0-b3b7-4226-8ef9-d57986796201`) from MFA-enforcing policies via `Invoke-MgGraphRequest` in pwsh 7.
