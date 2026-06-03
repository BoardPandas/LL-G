---
tech: intune
tags: [intune, mobileApps, app-assignment, iosStoreApp, publishingState, graph-api, conflict-resolution]
severity: high
---
# Intune mobileApp assignment fails until publishingState is 'published'

## PROBLEM
After creating a store app (e.g. `iosStoreApp`) via Graph, you immediately POST an assignment and get `400 BadRequest`: `Invalid operation: app's PublishingState is not 'Published'`. A freshly created app starts in `publishingState = processing` and only accepts assignments once Intune flips it to `published`. The transition is asynchronous and is not instant, so a create-then-assign script that does not wait will fail intermittently.

## WRONG
```powershell
$app = Invoke-MgGraphRequest -Method POST -Uri $appsUri -Body ($iosBody | ConvertTo-Json -Depth 6)
# app.publishingState is 'processing' here -> the next call 400s
Invoke-MgGraphRequest -Method POST `
    -Uri "https://graph.microsoft.com/v1.0/deviceAppManagement/mobileApps/$($app.id)/assignments" `
    -Body ($assignBody | ConvertTo-Json -Depth 5)
```

## RIGHT
```powershell
$base = "https://graph.microsoft.com/v1.0/deviceAppManagement/mobileApps/$($app.id)"
$state = $null
for ($i = 1; $i -le 30; $i++) {
    $state = (Invoke-MgGraphRequest -Method GET -Uri $base).publishingState
    if ($state -eq 'published') { break }
    Start-Sleep -Seconds 20
}
if ($state -ne 'published') { throw "App still '$state'; cannot assign yet." }

$assignBody = @{
    '@odata.type' = '#microsoft.graph.mobileAppAssignment'
    intent        = 'available'
    target        = @{ '@odata.type' = '#microsoft.graph.allLicensedUsersAssignmentTarget' }
}
Invoke-MgGraphRequest -Method POST -Uri "$base/assignments" -Body ($assignBody | ConvertTo-Json -Depth 5)
```

## NOTES
- `available` intent requires a *user* target (`allLicensedUsersAssignmentTarget` = "All Users"). It cannot target `allDevicesAssignmentTarget`.
- Assignment-conflict trap: when an Android managed-store app is added through the portal wizard, watch for a stray `uninstall -> All Devices` assignment (virtual group GUID prefix `adadadad-...`) created alongside the intended `available -> All Users` (`acacacac-...`). In an available-vs-uninstall conflict the **uninstall intent wins** and the app is removed from devices, defeating self-install. Delete the unintended assignment: `DELETE /deviceAppManagement/mobileApps/{id}/assignments/{assignmentId}` (guard on `intent -eq 'uninstall'` before deleting).
- If the app never leaves `processing`, see [iosStoreApp can wedge in processing](iosstoreapp-stuck-processing-recreate.md).
