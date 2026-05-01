---
tech: powershell
tags: [msal, oauth, token-cache, pwsh7, authentication]
severity: high
---
# MSAL.PS Enable-MsalTokenCacheOnDisk silently falls back to in-memory under PowerShell 7

## PROBLEM
`Enable-MsalTokenCacheOnDisk` is the documented way to persist MSAL tokens between PowerShell process invocations. Under PowerShell 7+ (`pwsh`) it prints a `WARNING:` line and silently uses an in-memory cache. Every script run requires a new device-code login, even though the code looks correct.

The warning is easy to miss in noisy script output:
> WARNING: Using TokenCache On Disk only works on Windows platform using Windows PowerShell. The token cache will stored in memory and not persisted on disk.

## WRONG
```powershell
# pwsh 7 -- looks correct, fails silently
Import-Module MSAL.PS
$pca = New-MsalClientApplication -ClientId $clientId -TenantId 'common'
$null = Enable-MsalTokenCacheOnDisk $pca -PassThru   # warning ignored

# Try silent (always fails after process restart)
try { $tok = Get-MsalToken -PublicClientApplication $pca -Scopes $scopes -Silent }
catch { $tok = Get-MsalToken -PublicClientApplication $pca -Scopes $scopes -DeviceCode }
```

## RIGHT
Three options:

### Option 1: Run the script under Windows PowerShell 5.1
```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\my-script.ps1'
# disk cache works, no device code on subsequent runs
```

### Option 2: Roll your own DPAPI-encrypted refresh-token cache (pwsh-friendly)
```powershell
# Persist refresh token via ConvertTo-SecureString + DPAPI (per-user, per-machine)
$rt | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString | Set-Content $cachePath
# Decrypt on next run via ConvertTo-SecureString from the file.
# Then use Get-MsalToken -RefreshToken to exchange for a fresh access token without device code.
```

### Option 3: Use Az.Accounts (Connect-AzAccount caches in profile dir cross-platform)
For Graph API calls, get a token via `Get-AzAccessToken -ResourceUrl 'https://graph.microsoft.com'` and use Invoke-RestMethod directly.

## NOTES
- This is a real platform limitation, not a bug: MSAL.NET's disk cache extensions on Windows depend on `Microsoft.Identity.Client.Extensions.Msal` which uses DPAPI. The MSAL.PS wrapper detects pwsh 7 and degrades gracefully (silently).
- Symptom: every script invocation prompts for a new device code even though `-Silent` is tried first.
- Always check the WARNING stream when troubleshooting MSAL caching. Pipe stderr to a log if running unattended.
- Don't try to work around it by clearing the cache in a `finally` block "for cleanliness" -- that just guarantees re-prompts even on PS 5.1.
