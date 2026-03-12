---
tech: graph-api
tags: [403, permissions, admin-consent, troubleshooting]
severity: medium
---
# 403 = missing admin consent, not missing permission

## PROBLEM
A 403 Forbidden response from Graph is almost always a missing admin consent grant, NOT a missing entry in the app registration's required permissions. The app may list the permission, but if an admin never granted consent, the token won't include that scope.

## WRONG
```powershell
# Assuming 403 means the permission isn't in the app registration
# Going to Azure Portal -> App Registrations -> API Permissions to ADD a permission
# The permission is already there -- it just hasn't been consented
```

## RIGHT
```powershell
# Step 1: Check what is actually granted (consented) vs what is declared
$sp = Get-MgServicePrincipal -Filter "appId eq '$appId'"
$grants = Get-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id
$grants | Select-Object AppRoleId, ResourceDisplayName | Format-Table

# Step 2: Compare AppRoleIds against the expected permission GUIDs
# If a permission is declared but not in $grants, admin consent is missing

# Step 3: Grant it (requires AppRoleAssignment.ReadWrite.All)
$graphSp = Get-MgServicePrincipal -Filter "displayName eq 'Microsoft Graph'"
New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -BodyParameter @{
    PrincipalId = $sp.Id
    ResourceId  = $graphSp.Id
    AppRoleId   = $missingPermissionGuid
}
```

## NOTES
- After granting consent, disconnect and reconnect -- the existing token won't have the new scope. See `permission-propagation.md`.
- OneDrive search is a common example: `Files.ReadWrite.All` is not enough for search. `Sites.ReadWrite.All` is also required (SharePoint-backed). The app may have `Files.ReadWrite.All` declared and consented but not `Sites.ReadWrite.All`.
- Sign-in log CA policy details are redacted without `Policy.Read.All` even if `AuditLog.Read.All` is consented.
