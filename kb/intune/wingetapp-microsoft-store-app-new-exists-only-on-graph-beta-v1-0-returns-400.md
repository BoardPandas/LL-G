---
tech: intune
tags: [graph-api, wingetapp, microsoft-store, mobileapps, beta, odata-select]
severity: medium
---
# winGetApp (Microsoft Store app new) exists only on Graph beta; v1.0 returns 400 Invalid OData type

## PROBLEM
Creating an Intune "Microsoft Store app (new)" via Graph v1.0 fails with `400 Invalid OData type specified: "microsoft.graph.winGetApp"`; the type exists only on beta.
The portal calls this app type "Microsoft Store app (new)" and other mobileApp types (win32LobApp, iosStoreApp) work on v1.0, so the error reads like a typo in the type name rather than a version problem. A second trap: `$select` on `GET /mobileApps/{id}` binds to the base `mobileApp` type, so selecting a derived property such as `packageIdentifier` returns `400 Could not find a property named 'packageIdentifier' on type 'microsoft.graph.mobileApp'`.

## WRONG
```http
POST https://graph.microsoft.com/v1.0/deviceAppManagement/mobileApps
{ "@odata.type": "#microsoft.graph.winGetApp", "packageIdentifier": "<store-id>", ... }
# 400 Invalid OData type specified

GET https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/{id}?$select=id,publishingState,packageIdentifier
# 400 Could not find a property named 'packageIdentifier'
```

## RIGHT
```http
POST https://graph.microsoft.com/beta/deviceAppManagement/mobileApps
{
  "@odata.type": "#microsoft.graph.winGetApp",
  "displayName": "App", "publisher": "Vendor",
  "packageIdentifier": "<store-id>",
  "installExperience": { "@odata.type": "microsoft.graph.winGetAppInstallExperience", "runAsAccount": "user" }
}
# 201

POST https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/{id}/assign
{ "mobileAppAssignments": [{
  "@odata.type": "#microsoft.graph.mobileAppAssignment", "intent": "available",
  "target": { "@odata.type": "#microsoft.graph.groupAssignmentTarget", "groupId": "<group-id>" },
  "settings": { "@odata.type": "#microsoft.graph.winGetAppAssignmentSettings", "notifications": "showAll" } }] }

GET https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/{id}?$select=id,publishingState
GET https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/{id}/assignments
```

## NOTES
- Take `runAsAccount` from the package manifest's installer `Scope` (user or machine); `winget show <id> --source msstore` or the Store manifest API shows it.
- `publishingState` went processing -> published in about a minute. See intune/mobileapp-assignment-requires-published-state.
- Right after `/assign`, the app's `isAssigned` still read false while `/assignments` already listed the assignment. Verify via `/assignments`, not the flag.
- Worked with app-only (certificate) auth.
