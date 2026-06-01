---
tech: meraki
tags: [meraki, powershell, invoke-restmethod, invoke-webrequest, pagination, strictmode]
severity: medium
---
# Invoke-RestMethod intermittently truncates Meraki list responses (use Invoke-WebRequest + per-org IDs)

## PROBLEM
When iterating the Cisco Meraki Dashboard API from PowerShell 7, `Invoke-RestMethod "GET /organizations"` intermittently returns a SINGLE org (or a malformed single record whose `.id`/`.name` are arrays) instead of the full MSP-wide list -- and the result varies run to run for the same key. Per-org `/devices` calls similarly come back with array-valued/garbled fields. The root cause is `Invoke-RestMethod`'s automatic JSON deserialization intermittently truncating/misparsing the response body; the HTTP call itself succeeds (200), so there is no error to catch. This is dangerous because it silently under-reports inventory: a roadmap run wrongly concluded two client networks were "not in our Meraki account / base-building" when they were actually present and licensed -- the orgs were simply missing from a truncated list. A retry loop that keys on "count > 1" can also lock onto the bad parse forever.

## WRONG
```powershell
# Auto-parse: intermittently returns 1 org instead of all 18, varying per run
$orgs = @(Invoke-RestMethod -Uri "$base/organizations?perPage=1000" -Headers $h)
if ($orgs.Count -le 1) { <# wrongly conclude the key only sees one org #> }

foreach ($o in $orgs) {
    # $o.name may be an array under StrictMode when the body was misparsed
    if ($o.name -match 'Client') { ... }   # throws or matches garbage
}
```

## RIGHT
```powershell
# Fetch raw, then parse the body yourself -- returns the full, correct list every time
$resp = Invoke-WebRequest -Uri "$base/organizations?perPage=1000" -Headers $h
$orgs = @($resp.Content | ConvertFrom-Json)   # complete 18-org list

# Capture org IDs once; address orgs by explicit ID afterward (reliable even when
# the list endpoint is flaky):
$detail = Invoke-WebRequest -Uri "$base/organizations/$oid" -Headers $h | % Content | ConvertFrom-Json
$nets   = Invoke-WebRequest -Uri "$base/organizations/$oid/networks?perPage=1000" -Headers $h | % Content | ConvertFrom-Json
$devs   = Invoke-WebRequest -Uri "$base/organizations/$oid/devices?perPage=1000"  -Headers $h | % Content | ConvertFrom-Json

# Guard optional fields under StrictMode (parsed objects vary in shape):
$name = if ($o.PSObject.Properties.Name -contains 'name') { [string]$o.name } else { '' }
```

## NOTES
- A specific org pulled by explicit ID (`/organizations/{id}`, `/networks`, `/devices`) is reliable even when the LIST endpoint is flaky. Capture IDs once and address orgs by ID instead of re-listing.
- When Meraki access to an org is granted mid-session, the list endpoint can be eventually-consistent and briefly return partial results -- retry, or go straight to the known org ID (which works immediately).
- Wrap pipeline results in `@()` before `.Count`/indexing, and guard optional properties with `$obj.PSObject.Properties.Name -contains 'x'` under StrictMode, since the misparse can yield hashtables or array-valued props.
- Related: `api-key-msp-wide.md` (the key is MSP-wide and org names differ from client names) -- a truncated list compounds that gotcha by hiding orgs entirely.
