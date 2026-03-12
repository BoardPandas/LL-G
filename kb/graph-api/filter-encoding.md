---
tech: graph-api
tags: [filter, odata, url-encoding, guid, BadRequest]
severity: medium
---
# URL-encode single quotes as %27 in filter queries

## PROBLEM
PowerShell strips or mishandles single quotes inside filter strings passed to `Invoke-MgGraphRequest`. Graph receives an unquoted GUID or string and returns `BadRequest` with a confusing type mismatch message (`incompatible types 'Edm.String' and 'Edm.Guid'`).

## WRONG
```powershell
# BAD -- single quotes stripped, bare GUID fails
$filter = "appId eq '$appId'"
$uri = "/v1.0/servicePrincipals?`$filter=$filter"
# Error: "Invalid filter clause: incompatible types 'Edm.String' and 'Edm.Guid'"
```

## RIGHT
```powershell
# GOOD -- %27 for single quotes in URI strings
$uri = "/v1.0/servicePrincipals?`$filter=appId%20eq%20%27$appId%27"

# Also works with -All flag on SDK cmdlets (SDK handles encoding automatically)
$sp = Get-MgServicePrincipal -Filter "appId eq '$appId'"
```

## NOTES
- This only affects `Invoke-MgGraphRequest` where you build the URI string manually. SDK cmdlets like `Get-MgServicePrincipal -Filter` handle encoding automatically.
- For ISO 8601 date filter queries, use explicit UTC format:
  ```powershell
  $filter = "createdDateTime ge '$($date.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))'"
  ```
- `%20` = space, `%27` = single quote. Those are the two most common encodings needed in Graph filter strings.
