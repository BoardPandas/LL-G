---
tech: intune
tags: [intune, iosStoreApp, publishingState, mobileApps, graph-api, troubleshooting]
severity: medium
---
# A new iosStoreApp can wedge in publishingState=processing for an hour -- delete and recreate

## PROBLEM
A newly created `iosStoreApp` normally moves `processing -> published` within 1-5 minutes. Occasionally Intune's AppLifecycle backend stalls and the app stays in `processing` for an hour or more. The app definition, bundleId, store URL, and your permissions are all fine -- it is a Microsoft-side ingestion lag. While stuck, the app cannot be assigned (see related entry), so a create-then-assign workflow appears to hang.

## WRONG
```powershell
# Polling forever / assuming the create body is malformed and editing it repeatedly.
# Re-PATCHing fields does not unstick it; the entry is wedged server-side.
while ($true) {
    if ((Invoke-MgGraphRequest -Method GET -Uri $base).publishingState -eq 'published') { break }
    Start-Sleep 60   # could spin for hours
}
```

## RIGHT
```powershell
# After a reasonable wait (~30-45 min) with no progress, delete the (unassigned) app and recreate it.
# Guard: only delete if it has NO assignments, so you never remove a live app.
$assign = Invoke-MgGraphRequest -Method GET -Uri "$base/assignments"
if (@($assign.value).Count -eq 0) {
    Invoke-MgGraphRequest -Method DELETE -Uri $base | Out-Null
    $new = Invoke-MgGraphRequest -Method POST -Uri $appsUri -Body ($iosBody | ConvertTo-Json -Depth 6)
    # then poll the NEW id for publishingState -eq 'published' and assign
}
```

## NOTES
- Recreating gives a new app `id` -- update any downstream references (assignment scripts, ticket notes, watchers).
- If the recreate also wedges, it is a transient tenant/backend issue, not your script -- the catalog entry is still valid and can be assigned later once it publishes.
- Run the wait+assign as a background watcher so you are not blocking on Microsoft's ingestion.
