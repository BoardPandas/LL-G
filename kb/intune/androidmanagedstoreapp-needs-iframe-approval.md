---
tech: intune
tags: [intune, androidManagedStoreApp, managed-google-play, app-only, certificate, graph-api, mobileApps]
severity: high
---
# androidManagedStoreApp cannot be created via app-only/cert Graph -- approve in the Managed Google Play iframe

## PROBLEM
You want to publish a Managed Google Play app (for Android Enterprise work profiles) into the Intune catalog using app-only / certificate Graph auth. Creating an `iosStoreApp` this way works fine, so you assume the Android equivalent does too. It does not. A `POST /deviceAppManagement/mobileApps` with `@odata.type` = `#microsoft.graph.androidManagedStoreApp` returns `400 BadRequest` from Intune's AppLifecycle service (`StatelessAppMetadataFEService`), even with `DeviceManagementApps.ReadWrite.All` and a healthy `boundAndValidated` Managed Google Play binding.

Managed Google Play apps are not created by direct object POST; they are *approved* in the Google Play iframe inside the Intune portal, which then auto-syncs them into Intune as `androidManagedStoreApp` objects. The iframe is an interactive Google-auth surface that app-only automation cannot drive.

## WRONG
```powershell
# 400 BadRequest from AppLifecycle StatelessAppMetadataFEService
$body = @{
    '@odata.type' = '#microsoft.graph.androidManagedStoreApp'
    displayName   = 'CyberArk Mobile'
    packageId     = 'com.cyberark.alero'
    productId     = 'app:com.cyberark.alero'
    appStoreUrl   = 'https://play.google.com/store/apps/details?id=com.cyberark.alero'
}
Invoke-MgGraphRequest -Method POST `
    -Uri "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps" `
    -Body ($body | ConvertTo-Json -Depth 6)
```

## RIGHT
```text
# Approve interactively (one-time, by any Intune admin), then automate the rest:
# Intune admin center > Apps > Android > Managed Google Play apps
#   -> (Google iframe) search the app by package id -> Approve
#   -> "Keep approved when app requests new permissions" -> Sync
# It appears as an androidManagedStoreApp within a few minutes.
```
```powershell
# After it syncs, find it and assign it via app-only Graph (this part works):
$apps = @()
$uri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps?`$top=100"
do {
    $r = Invoke-MgGraphRequest -Method GET -Uri $uri
    if ($r.value) { $apps += $r.value }
    $uri = $r.'@odata.nextLink'
} while ($uri)

$app = @($apps | Where-Object {
    $_.'@odata.type' -eq '#microsoft.graph.androidManagedStoreApp' -and $_.packageId -eq 'com.cyberark.alero'
}) | Select-Object -First 1
```

## NOTES
- Verify the binding first: `GET /beta/deviceManagement/androidManagedStoreAccountEnterpriseSettings` (note: the **v1.0** path returns 400; use **beta**). `bindStatus` should be `boundAndValidated`.
- The legacy `androidStoreApp` (device-administrator store-link) type *can* be POSTed, but it is the wrong type for Android Enterprise / work-profile delivery -- use Managed Google Play.
- `iosStoreApp` has no equivalent restriction; it can be created directly via app-only Graph. See [mobileApp assignment requires publishingState=published](mobileapp-assignment-requires-published-state.md).
