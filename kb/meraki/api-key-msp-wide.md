---
tech: meraki
tags: [dashboard-api, organizations, msp, multi-tenant, org-matching]
severity: high
---
# A Meraki Dashboard API key is MSP-wide -- filter /organizations by name

## PROBLEM
A single Cisco Meraki Dashboard API key usually has access to MANY organizations (often every client an MSP manages). `GET /organizations` returns ALL of them, not just one. Two failure modes follow:
1. Code that assumes one-org-per-key grabs the wrong org (or treats the whole list as one).
2. Matching the org by the client's name from another system fails, because the Meraki org name frequently differs (e.g. Meraki "Metropolitan Club of Washington" vs Zendesk/NinjaOne "Metro Club").

## WRONG
```powershell
# assumes the key maps to a single org
$org = Invoke-RestMethod -Uri "$base/organizations" -Headers $h
$orgId = $org.id          # $org is an ARRAY of every client org -> wrong/corrupt
```

## RIGHT
```powershell
$orgs = Invoke-RestMethod -Uri "$base/organizations" -Headers $h
$org  = @($orgs | Where-Object { $_.name -match 'Metropolitan|Metro' })[0]
if (-not $org) { throw "No Meraki org matched the client name/aliases" }
$orgId = $org.id
```

## NOTES
- Capture the client's name aliases up front; match fuzzy, not exact.
- When iterating the returned array, do NOT use member-enumeration like `$orgs.name` (it concatenates every org) -- use an explicit `foreach`. See the PowerShell "member enumeration" gotcha.
- Honor rate limits (~5 req/sec/org, HTTP 429 + Retry-After) and Link-header pagination.
