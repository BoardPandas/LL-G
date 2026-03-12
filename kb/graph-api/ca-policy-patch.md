---
tech: graph-api
tags: [conditional-access, patch, policy, conditions, users]
severity: high
---
# PATCH CA policy: send full conditions.users object

## PROBLEM
When PATCHing a Conditional Access policy to add or remove users, sending only the changed field (e.g., just `excludeUsers`) silently overwrites the other fields in the same object. `includeUsers`, `includeGroups`, `excludeGroups` are cleared to empty if not included in the PATCH body.

## WRONG
```powershell
# BAD -- only sending the field you want to change
$patchBody = @{
    conditions = @{
        users = @{
            excludeUsers = @($existingExcluded + $newUserId)
        }
    }
}
Invoke-MgGraphRequest -Method PATCH -Uri "/v1.0/identity/conditionalAccess/policies/$policyId" -Body $patchBody
# Result: includeUsers, includeGroups, excludeGroups all cleared to empty
```

## RIGHT
```powershell
# GOOD -- read current state, modify, send full users object
$policy = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/identity/conditionalAccess/policies/$policyId"

$patchBody = @{
    conditions = @{
        users = @{
            includeUsers  = @($policy.conditions.users.includeUsers)
            excludeUsers  = @($policy.conditions.users.excludeUsers + $newUserId)
            includeGroups = @($policy.conditions.users.includeGroups)
            excludeGroups = @($policy.conditions.users.excludeGroups)
        }
    }
}
Invoke-MgGraphRequest -Method PATCH -Uri "/v1.0/identity/conditionalAccess/policies/$policyId" -Body $patchBody
```

## NOTES
- Requires `Policy.Read.All` + `Policy.ReadWrite.ConditionalAccess` -- NOT included in the standard app permission set. Must be granted separately. See `permission-propagation.md`.
- The same "send the full object" rule applies to other nested PATCH operations in Graph (e.g., `signInAudience`, application `web.redirectUris`).
- `@()` wrapping around existing arrays is important -- if the source value is `$null`, `@($null + $newItem)` gives you `@($null, $newItem)`. Null-check before constructing if the policy may have empty fields.
