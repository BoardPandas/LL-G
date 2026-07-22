---
tech: graph-api
tags: [offboarding, groups, ownership, memberof, ownedobjects, sharepoint, deprovisioning]
severity: high
---
# /memberOf never returns group ownership -- offboarding silently orphans groups

## PROBLEM
Offboarding scripts enumerate a departing user's groups with `GET /users/{id}/memberOf` and delete each membership. That endpoint returns **memberships only**. Group **ownership** is a separate relationship and is never included in the response.

If the leaver was the *sole owner* of a Microsoft 365 group, removing them leaves the group and its backing SharePoint site with zero owners. Graph returns `204 No Content` for every call. Nothing warns you, and the group keeps working, so the script reports a clean run. The damage only surfaces later when someone needs to change membership, rename the group, or manage the site and finds nobody has rights to do it.

The problem compounds over time: ownership is not cleaned up by disabling an account, so tenants accumulate groups owned entirely by long-disabled users. An earlier offboarding that "removed them from all 20 groups" almost certainly meant memberships and left every ownership intact.

## WRONG
```powershell
# Enumerates memberships only -- ownership is invisible to this query
$groups = @((Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/users/$userId/memberOf" `
    -OutputType PSObject).value)

foreach ($g in $groups) {
    Invoke-MgGraphRequest -Method DELETE `
        -Uri "https://graph.microsoft.com/v1.0/groups/$($g.id)/members/$userId/`$ref"
}
# Every call returns 204. Any group this user solely OWNED is now orphaned,
# along with its SharePoint site, and the script reports success.
```

## RIGHT
```powershell
# 1. Ownership requires a SEPARATE query -- /ownedObjects, not /memberOf
$owned = @((Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/users/$userId/ownedObjects" `
    -OutputType PSObject).value |
    Where-Object { $_.'@odata.type' -eq '#microsoft.graph.group' })

# 2. Check the SOLE-OWNER condition and reassign BEFORE removing anything
foreach ($g in $owned) {
    $owners = @((Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/v1.0/groups/$($g.id)/owners" `
        -OutputType PSObject).value)

    $others = @($owners | Where-Object { $_.id -ne $userId })
    if ($others.Count -eq 0) {
        Write-Warning "$($g.displayName): SOLE OWNER. Reassigning before removal."
        Invoke-MgGraphRequest -Method POST `
            -Uri "https://graph.microsoft.com/v1.0/groups/$($g.id)/owners/`$ref" `
            -Body (@{ '@odata.id' = "https://graph.microsoft.com/v1.0/users/$replacementOwnerId" } | ConvertTo-Json) `
            -ContentType 'application/json'
    }
}

# 3. Only now strip memberships AND ownerships
foreach ($g in $owned) {
    Invoke-MgGraphRequest -Method DELETE `
        -Uri "https://graph.microsoft.com/v1.0/groups/$($g.id)/owners/$userId/`$ref"
}
```

## NOTES
- Verify the reassignment before removing the old owner. Graph owner writes replicate with lag, so an immediate `GET /owners` can still show only the original owner. Re-read after ~15s. See [read-after-write-lag.md](read-after-write-lag.md).
- `/memberOf` also returns Exchange **distribution lists** (they appear as groups with an empty `groupTypes` array and `mailEnabled: true`), but Graph cannot modify DL membership. Remove those via EXO `Remove-DistributionGroupMember`.
- `/transitiveMemberOf` is a different axis (nested groups). Neither it nor `/memberOf` returns ownership.
- To audit accumulated damage: enumerate disabled accounts (`$filter=accountEnabled eq false`), call `/users/{id}/ownedObjects` for each, then flag any group whose owner set consists entirely of disabled accounts.
- The same blind spot applies to application and service-principal ownership, which `/ownedObjects` also returns. Filter by `@odata.type` rather than assuming everything is a group.
