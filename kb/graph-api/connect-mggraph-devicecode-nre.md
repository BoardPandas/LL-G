---
tech: graph-api
tags: [microsoft-graph-sdk, device-code, authentication, invoke-mggraphrequest]
severity: high
---
# Connect-MgGraph -UseDeviceCode followed by Invoke-MgGraphRequest throws Object reference not set

## PROBLEM
`Connect-MgGraph -UseDeviceCode` succeeds (the script prints "Welcome to Microsoft Graph!" / context resolves), but the very next `Invoke-MgGraphRequest` call throws:

> Invoke-MgGraphRequest: DeviceCodeCredential authentication failed: Object reference not set to an instance of an object.

This is a known interaction between the device-code credential implementation and the SDK's HTTP pipeline in certain Microsoft.Graph PowerShell SDK versions. Re-invoking `Connect-MgGraph` does not help. The token cache is in a state where it has the user identity but cannot satisfy the silent-refresh path Invoke-MgGraphRequest takes for every call.

## WRONG
```powershell
Connect-MgGraph -Scopes 'Chat.Read','User.Read' -UseDeviceCode
# (sign-in completes successfully)
$resp = Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/v1.0/me/chats'
# Throws: DeviceCodeCredential authentication failed: Object reference not set to an instance of an object.
```

## RIGHT
Bypass `Invoke-MgGraphRequest` entirely. Acquire the token via `MSAL.PS` (or any other MSAL wrapper), then call Graph with raw `Invoke-RestMethod`:

```powershell
Import-Module MSAL.PS
$clientId = '14d82eec-204b-4c2f-b7e8-296a70dab67e'  # Microsoft Graph PowerShell well-known client
$scopes = @(
    'https://graph.microsoft.com/Chat.Read',
    'https://graph.microsoft.com/User.Read'
)
$tok = Get-MsalToken -ClientId $clientId -TenantId 'common' -Scopes $scopes -DeviceCode
$headers = @{ Authorization = "Bearer $($tok.AccessToken)" }
$resp = Invoke-RestMethod -Method GET -Uri 'https://graph.microsoft.com/v1.0/me/chats' -Headers $headers
```

Or use the typed cmdlets (`Get-MgUser`, `Get-MgChat`, etc.) which take a different code path and do not hit the Invoke-MgGraphRequest credential bug.

## NOTES
- Confirmed against Microsoft.Graph SDK versions through 2.x. May be fixed in future versions; revisit periodically.
- Adding `-ContextScope Process` to Connect-MgGraph does not fix it.
- The error is misleading: it says "authentication failed" but auth already succeeded -- the failure is on the silent token refresh inside Invoke-MgGraphRequest.
- This does NOT affect cert-based auth (`-CertificateThumbprint`) or interactive browser auth, only `-UseDeviceCode`.
- For tenants where you only have user credentials (no app registration with cert), MSAL.PS + Invoke-RestMethod is the most reliable path.
