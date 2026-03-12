---
tech: graph-api
tags: [pagination, nextlink, odata, list-operations, get-mguser]
severity: high
---
# Always use -All or follow @odata.nextLink

## PROBLEM
Graph API list endpoints return a maximum of 999 items per page by default. Omitting pagination silently returns a partial result set with no warning -- scripts that process the results will miss records.

## WRONG
```powershell
# BAD -- only gets first page (up to 999 users)
$users = Get-MgUser -Filter "accountEnabled eq true"
# If there are 5,000 users, you got 999
```

## RIGHT
```powershell
# GOOD -- SDK cmdlet with -All flag
$users = Get-MgUser -Filter "accountEnabled eq true" -All

# For Invoke-MgGraphRequest, follow @odata.nextLink manually
$allResults = @()
$uri = "/v1.0/users?`$filter=accountEnabled eq true&`$top=999"
do {
    $response = Invoke-MgGraphRequest -Method GET -Uri $uri
    $allResults += $response.value
    $uri = $response.'@odata.nextLink'
} while ($uri)
```

## NOTES
- All SDK cmdlets that return collections support `-All`. Use it by default for any operation where result completeness matters.
- `$top=999` is the max value for the `$top` query parameter. Setting it higher than 999 is silently capped.
- `@odata.nextLink` is only present in the response if there are more pages. The `do/while` pattern above handles single-page and multi-page results.
- Pagination applies to users, groups, service principals, sign-in logs, audit logs, and all other collection endpoints.
