---
tech: graph-api
tags: [directory-roles, rbac, role-membership, self-removal, rollback, app-only, badrequest]
severity: high
---
# A security principal cannot remove ITSELF from a directory role

## PROBLEM
`DELETE /directoryRoles/{roleId}/members/{spId}/$ref` (or the equivalent
roleManagement `roleAssignments` DELETE) returns `400 Request_BadRequest` with
"Unable to remove current authenticated principal from Role membership. Current
user has no privilege to remove self from <Role> role." Entra blocks a principal
from stripping its own directory-role membership. So if an app-only automation
grants ITSELF a directory role (e.g. Compliance Administrator to run audit-log
searches), it can NEVER clean that role off using its own credentials. Plan the
rollback before you grant.

## WRONG
```powershell
# App-only context authenticated AS the SP you are trying to clean up
Connect-MgGraph -ClientId $appId -TenantId $tid -CertificateThumbprint $thumb `
    -Scopes RoleManagement.ReadWrite.Directory
# 400 Request_BadRequest -- "remove self" is not allowed
Remove-MgDirectoryRoleMemberDirectoryObjectByRef `
    -DirectoryRoleId $roleId -DirectoryObjectId $ourSpId
```

## RIGHT
```powershell
# A DIFFERENT admin principal must do the removal: an interactive Global Admin,
# or a separate service principal that is not the role member being removed.
Connect-MgGraph -TenantId $tid -Scopes RoleManagement.ReadWrite.Directory `
    -UseDeviceCode          # signs in as a human admin, not the target SP
Remove-MgDirectoryRoleMemberDirectoryObjectByRef `
    -DirectoryRoleId $roleId -DirectoryObjectId $targetSpId
# Verify
@(Get-MgServicePrincipalMemberOf -ServicePrincipalId $targetSpId -All).Count
```

## NOTES
- Applies to both the directory-role member `$ref` DELETE and the unified RBAC
  `roleAssignments` DELETE.
- The restriction is the principal removing ITSELF, not the role: another SP with
  `RoleManagement.ReadWrite.Directory` can remove the target SP fine.
- Design rule: if automation self-elevates, give a separate de-provisioning
  identity (or document the manual portal step) so cleanup is actually possible.
