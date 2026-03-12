---
tech: powershell
tags: [dates, utc, graph-api, datetime, KeyCredentialsInvalidEndDate]
severity: high
---
# Always use UTC for Graph API and external API date fields

## PROBLEM
`[DateTime]::Now` returns local time with a timezone offset. The Graph API (and many other external APIs) expect UTC. Passing a local-time `DateTime` causes errors like `KeyCredentialsInvalidEndDate`, subscription expiry rejections, and calendar event mismatches.

## WRONG
```powershell
# BAD -- local time, Graph API rejects it
$notBefore = [DateTime]::Now
$notAfter = [DateTime]::Now.AddYears(2)
```

## RIGHT
```powershell
# GOOD -- UTC
$notBefore = [DateTime]::UtcNow
$notAfter = [DateTime]::UtcNow.AddYears(2)

# For filter queries, format explicitly as ISO 8601 UTC:
$filter = "createdDateTime ge '$($date.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))'"
```

## NOTES
- This applies to: certificate key credentials, subscription expiry, calendar events, conditional access policy dates, and any other Graph endpoint that accepts datetime values.
- Exception: when creating a certificate with `New-SelfSignedCertificate`, use `[DateTime]::Now` -- the cert's `NotBefore`/`NotAfter` properties are then used directly in Graph calls (Graph handles the conversion). See `C:\Github\LL-G\kb\graph-api\key-credentials.md`.
- `$date.ToUniversalTime()` converts any DateTime to UTC. Use `.ToString("yyyy-MM-ddTHH:mm:ssZ")` for Graph filter queries.
