---
tech: graph-api
tags: [429, 503, throttling, retry, invoke-mggraphrequest, rate-limit]
severity: medium
---
# 429/503: Invoke-MgGraphRequest does not auto-retry

## PROBLEM
The Microsoft Graph SDK cmdlets (`Get-MgUser`, etc.) automatically handle 429 throttling by reading the `Retry-After` response header and waiting. `Invoke-MgGraphRequest` does not -- it throws immediately on 429 or 503.

## WRONG
```powershell
# No retry -- throws on first 429
$result = Invoke-MgGraphRequest -Method GET -Uri $uri
```

## RIGHT
```powershell
# Add retry logic for Invoke-MgGraphRequest
$maxRetries = 3
for ($i = 0; $i -lt $maxRetries; $i++) {
    try {
        $result = Invoke-MgGraphRequest -Method GET -Uri $uri
        break
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -in @(429, 503) -and $i -lt ($maxRetries - 1)) {
            $retryAfter = $_.Exception.Response.Headers['Retry-After'] | Select-Object -First 1
            $wait = if ($retryAfter) { [int]$retryAfter } else { [math]::Pow(2, $i + 1) }
            Write-Host "Rate limited ($statusCode). Waiting ${wait}s..."
            Start-Sleep -Seconds $wait
        } else { throw }
    }
}
```

## NOTES
- SDK cmdlets (`Get-MgUser`, `New-MgServicePrincipal`, etc.) handle 429 automatically. This gotcha applies only to `Invoke-MgGraphRequest`.
- For bulk Teams API operations (channel creation, member management), add `Start-Sleep -Milliseconds 500` between calls to proactively avoid throttling.
- The `Retry-After` header value is seconds. If absent, use exponential backoff: 2, 4, 8 seconds.
