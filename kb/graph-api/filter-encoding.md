---
tech: graph-api
tags: [filter, odata, url-encoding, guid, BadRequest, invoke-mggraphrequest]
severity: medium
---
# URL-encode single quotes as %27 -- only when you build the URI string yourself

## DECISION RULE
Encode **exactly once**, at the layer that builds the URL.

| What you are doing | Who owns encoding | What to pass |
|---|---|---|
| Concatenating a URI string (`Invoke-MgGraphRequest -Uri "...?$filter=..."`, `curl`, raw REST) | **You** | `%27` and `%20` -- this entry |
| Passing `$filter` as a parameter (SDK `-Filter`, an MCP tool's `query` object, any typed client) | **The library** | plain single quotes -- see [filter-double-encoding-via-wrapper.md](filter-double-encoding-via-wrapper.md) |

Getting this backwards fails in both directions, with two different and equally confusing errors. This entry covers the first row.

## PROBLEM
When you build the URI yourself, PowerShell strips or mishandles single quotes inside filter strings passed to `Invoke-MgGraphRequest`. Graph receives an unquoted GUID or string and returns `BadRequest` with a confusing type mismatch message (`incompatible types 'Edm.String' and 'Edm.Guid'`).

## WRONG
```powershell
# BAD -- single quotes stripped, bare GUID fails
$filter = "appId eq '$appId'"
$uri = "/v1.0/servicePrincipals?`$filter=$filter"
# Error: "Invalid filter clause: incompatible types 'Edm.String' and 'Edm.Guid'"
```

## RIGHT
```powershell
# GOOD -- %27 for single quotes in URI strings you construct
$uri = "/v1.0/servicePrincipals?`$filter=appId%20eq%20%27$appId%27"

# Also fine -- SDK cmdlets take the -Filter PARAMETER and encode it for you,
# so here you pass plain quotes and must NOT pre-encode
$sp = Get-MgServicePrincipal -Filter "appId eq '$appId'"
```

## NOTES
- The two lines above are the whole distinction: `-Uri` is a string you built (encode it), `-Filter` is a parameter you handed over (don't).
- If you pre-encode into a parameter-style interface, `%27` reaches Graph literally and you get `Invalid filter clause: Syntax error: character '%' is not valid at position N`. That is the mirror-image failure, covered in [filter-double-encoding-via-wrapper.md](filter-double-encoding-via-wrapper.md).
- For ISO 8601 date filter queries, use explicit UTC format:
  ```powershell
  $filter = "createdDateTime ge '$($date.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))'"
  ```
- `%20` = space, `%27` = single quote. Those are the two most common encodings needed in hand-built Graph filter strings.
