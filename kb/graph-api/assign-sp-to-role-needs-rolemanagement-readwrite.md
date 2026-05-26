---
tech: graph-api
tags: [directory-roles, rbac, rolemanagement-readwrite-directory, directory-readwrite-all, app-only, authorization-requestdenied, service-principal]
severity: high
---
# Adding a service principal to a directory role needs RoleManagement.ReadWrite.Directory (not Directory.ReadWrite.All)

## PROBLEM
`POST /directoryRoles/{roleId}/members/$ref` to add a service principal to a
directory role returns `403 Authorization_RequestDenied` when the calling app
holds only `Directory.ReadWrite.All`. Despite how broad it sounds,
`Directory.ReadWrite.All` does NOT cover directory-role membership writes. You
need `RoleManagement.ReadWrite.Directory`. This bites because
`Directory.ReadWrite.All` is already a very high-privilege grant, so the 403 on a
"lesser" operation is counterintuitive.

## WRONG
```powershell
# App has Directory.ReadWrite.All (application) + admin consent
Connect-MgGraph -ClientId $appId -TenantId $tid -CertificateThumbprint $thumb
# 403 Authorization_RequestDenied -- not enough for role membership writes
New-MgDirectoryRoleMemberByRef -DirectoryRoleId $roleId `
    -OdataId "https://graph.microsoft.com/v1.0/directoryObjects/$spId"
```

## RIGHT
```powershell
# Grant the app RoleManagement.ReadWrite.Directory (application) + admin consent,
# then add the SP to the role.
Connect-MgGraph -ClientId $appId -TenantId $tid -CertificateThumbprint $thumb
New-MgDirectoryRoleMemberByRef -DirectoryRoleId $roleId `
    -OdataId "https://graph.microsoft.com/v1.0/directoryObjects/$spId"
```

## NOTES
- The role must be ACTIVATED in the tenant first. Built-in roles exist as
  templates; if `Get-MgDirectoryRole` doesn't list it, activate from the template
  via `New-MgDirectoryRole -RoleTemplateId <templateId>` before adding members.
- Removing a member has the same permission requirement -- and remember a
  principal still cannot remove ITSELF (separate gotcha).
- `RoleManagement.ReadWrite.Directory` is a tier-0 privileged grant; gate it
  behind your permissions-pass / change-control process.
