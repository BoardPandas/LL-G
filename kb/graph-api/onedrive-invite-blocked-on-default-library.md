---
tech: graph-api
tags: [onedrive, sharepoint, permissions, offboarding, drive-invite]
severity: high
---
# Graph /drive/root/invite is blocked on the OneDrive default document library

## PROBLEM
During an offboarding (or any "grant another user access to person X's OneDrive" workflow), the natural Graph call is `POST /drives/{id}/root/invite`. Microsoft hard-blocks this on OneDrive personal sites with:

```
{
  "error": {
    "code": "invalidRequest",
    "message": "Sharing or permission updating on the default document library is not supported in OneDrive."
  }
}
```

It fails regardless of the Graph permissions granted to the app. `Files.ReadWrite.All` + `Sites.ReadWrite.All` is not enough -- there is no Graph permission that lifts this restriction. The block also applies to `POST /drives/{id}/items/{root-id}/invite` and to inviting by `objectId`, `email`, or `alias`. Same 400 every time.

The supported way to grant another user access to someone's entire OneDrive is to make them a **site collection admin** on the personal site, which has to be done through the SharePoint admin API -- not Graph.

## WRONG
```powershell
# All three variants return 400 "Sharing or permission updating on the
# default document library is not supported in OneDrive."
$body = @{ requireSignIn = $true; sendInvitation = $false; roles = @('write')
           recipients = @(@{ email = 'delegate@contoso.com' }) } | ConvertTo-Json
Invoke-MgGraphRequest -Method POST `
  -Uri "https://graph.microsoft.com/v1.0/drives/$driveId/root/invite" `
  -Body $body -ContentType 'application/json'
```

## RIGHT
Use a SharePoint admin permission (separate API resource) and the SPO/PnP path:

```powershell
# 1. App needs Sites.FullControl.All from the SharePoint resource
#    (resourceAppId 00000003-0000-0ff1-ce00-000000000000,
#     appRoleId    678536fe-1083-478a-9c59-b99265e6b0d3).
#    This is NOT the same scope as Graph Sites.FullControl.All -- it's a
#    different resource.

# 2. Then use PnP.PowerShell (or SPO module) with cert auth:
$oneDriveUrl = 'https://contoso-my.sharepoint.com/personal/alice_contoso_com'
Connect-PnPOnline -Url $oneDriveUrl `
  -ClientId $appId -Tenant 'contoso.com' -Thumbprint $thumb
Add-PnPSiteCollectionAdmin -Owners 'delegate@contoso.com'
```

## NOTES
- Graph `Sites.ReadWrite.All` (Microsoft Graph resource) and SharePoint `Sites.FullControl.All` (SharePoint resource) look similar but are two different API surfaces with separate app role IDs. You need the SharePoint one.
- This is the single biggest reason offboarding automation that "should just work via Graph" requires a SharePoint detour.
- If you only need to grant access to a specific file/folder under the default doc library, `invite` on that subitem works -- the block is specific to the root document library.
- `Set-PnPSiteCollectionAdmin` does not exist in modern PnP.PowerShell; use `Add-PnPSiteCollectionAdmin` / `Remove-PnPSiteCollectionAdmin`. (The SPO module equivalent is `Set-SPOUser -IsSiteCollectionAdmin $true`.)
- Granting `Sites.FullControl.All` (SharePoint resource) requires admin consent. Don't expect it to be there by default on existing app registrations; check `requiredResourceAccess` for `resourceAppId = 00000003-0000-0ff1-ce00-000000000000` before assuming.
- Discovered while offboarding mmeza@woodberryassociates.com (May 2026). Three Graph invite variants all returned the same `invalidRequest` -- it was a platform restriction, not a permissions problem.
