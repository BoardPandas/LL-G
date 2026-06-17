---
tech: graph-api
tags: [intune, devicemanagementscripts, platform-scripts, app-only, delegated, device-code, app-role, 403, wam]
severity: high
---
# Intune deviceManagementScripts rejects app-only tokens (delegated-only)

## PROBLEM
The Intune `deviceManagement/deviceManagementScripts` endpoint (platform PowerShell scripts) is served by the Intune `DeviceFE/StatelessDeviceFEService` proxy, which only honors DELEGATED Graph tokens. An app-only / certificate token returns HTTP 403 even when the `DeviceManagementScripts.ReadWrite.All` APPLICATION app-role is assigned and consented to the service principal. Assigning or re-consenting the application permission does not help (the app-role assignment can already exist and you still get 403). Two extra traps:
1. The required DELEGATED scope is specifically `DeviceManagementScripts.ReadWrite.All`. Requesting `DeviceManagementConfiguration.ReadWrite.All` (the scope older docs imply for Intune device config) still 403s on this endpoint.
2. Interactive `Connect-MgGraph` from an embedded / non-interactive shell fails with `InteractiveBrowserCredential authentication failed: A window handle must be configured` (Windows WAM needs a parent window handle), so you fall back to device-code, which collides with the existing LL-G gotcha that `-UseDeviceCode + Invoke-MgGraphRequest` throws an NRE.

## WRONG
```powershell
# App-only / cert auth (what the cert-based MSP connector uses) -> 403 on this endpoint
Connect-MgGraph -TenantId $tid -ClientId $appId -CertificateThumbprint $thumb -NoWelcome
Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/beta/deviceManagement/deviceManagementScripts'
# 403: "Application must have one of the following scopes:
#       DeviceManagementScripts.Read.All, DeviceManagementScripts.ReadWrite.All"
# ...even though the app-role IS assigned (POST appRoleAssignedTo returns
#   "Permission being assigned already exists on the object").

# Delegated but WRONG scope -> still 403 on create
# scope = 'https://graph.microsoft.com/DeviceManagementConfiguration.ReadWrite.All'
```

## RIGHT
```powershell
# DELEGATED auth with the DeviceManagementScripts scope. In a headless shell, use
# device-code, and avoid Invoke-MgGraphRequest (NRE) by calling REST with the raw token.
$tenantId = '<tenant-guid>'
$clientId = '14d82eec-204b-4c2f-b7e8-296a70dab67e'  # Microsoft Graph Command Line Tools (public client)

# 1) Device code (relay user_code + verification_uri to the admin)
$dc = Invoke-RestMethod -Method POST -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/devicecode" `
    -Body @{ client_id=$clientId; scope='https://graph.microsoft.com/DeviceManagementScripts.ReadWrite.All offline_access' }
Write-Host $dc.message

# 2) Poll for the token (handle authorization_pending / slow_down)
do {
    Start-Sleep -Seconds ([int]$dc.interval + 1)
    try { $tok = Invoke-RestMethod -Method POST -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" `
        -Body @{ grant_type='urn:ietf:params:oauth:grant-type:device_code'; client_id=$clientId; device_code=$dc.device_code } }
    catch { $e=($_.ErrorDetails.Message | ConvertFrom-Json).error; if ($e -notin 'authorization_pending','slow_down') { throw } }
} until ($tok.access_token)

# 3) Create + assign with Invoke-RestMethod (NOT Invoke-MgGraphRequest)
$h = @{ Authorization = "Bearer $($tok.access_token)" }
$created = Invoke-RestMethod -Method POST -ContentType 'application/json' -Headers $h `
    -Uri 'https://graph.microsoft.com/beta/deviceManagement/deviceManagementScripts' -Body $body
```

## NOTES
- Same delegated-only limitation applies to other Intune `DeviceFE`-proxied surfaces (e.g. `deviceShellScripts`, proactive `deviceHealthScripts`). If app-only 403s and the app-role is present, suspect delegated-only.
- If you cannot do delegated/interactive at all, deploy the file via a Win32 LOB app instead (app-only Graph CAN create Win32 apps + SAS-upload content) rather than a platform script.
- Related: `connect-mggraph-devicecode-nre.md` (why we skip Invoke-MgGraphRequest here) and `oauth2grants-need-delegated-permission-grant.md` (another "the docs' scope is not the real scope" case).
- Discovered 2026-06-17 pushing a Cloudflare WARP `mdm.xml` platform script to a tenant via the cert-based connector.
