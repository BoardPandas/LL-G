---
tech: graph-api
tags: [odata, select, query, memberOf, type]
severity: medium
---
# @odata.type cannot be used in $select queries

## PROBLEM
Including `@odata.type` in a `$select` parameter causes a 400 Bad Request. The `@odata.type` property is a system annotation returned automatically in responses -- it is not a selectable field. Common when querying `/users/{id}/memberOf` to distinguish groups from directory roles.

## WRONG
```powershell
# BAD -- @odata.type in $select causes 400
$uri = "https://graph.microsoft.com/v1.0/users/$userId/memberOf?`$select=id,displayName,groupTypes,@odata.type"
Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
# Error: "Parsing OData Select and Expand failed: Term '@odata.type' is not valid in a $select or $expand expression."
```

## RIGHT
```powershell
# GOOD -- omit @odata.type from $select; it's returned automatically
$uri = "https://graph.microsoft.com/v1.0/users/$userId/memberOf?`$select=id,displayName,groupTypes,mailEnabled,securityEnabled"
$result = Invoke-MgGraphRequest -Method GET -Uri $uri -OutputType PSObject
# @odata.type is available in each result object without selecting it
$groups = @($result.value | Where-Object { $_.'@odata.type' -eq '#microsoft.graph.group' })
$roles = @($result.value | Where-Object { $_.'@odata.type' -eq '#microsoft.graph.directoryRole' })
```

## NOTES
- This applies to all `@odata.*` annotations (`@odata.type`, `@odata.id`, `@odata.context`).
- The `@odata.type` field IS available in the response body -- just don't request it in `$select`.
- Access it in PowerShell using bracket notation: `$_.'@odata.type'` (dot notation won't work because of the `@`).
