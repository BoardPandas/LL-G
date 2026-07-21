---
tech: graph-api
tags: [dirsync, directory-sync, organization, hybrid-identity, entra-connect, 403, delegated-only, permissions, cloud-only]
severity: high
---
# Turning off tenant DirSync needs DELEGATED Organization.ReadWrite.All

## PROBLEM

Disabling directory synchronization (converting all synced users/groups to cloud-only) is
`PATCH /v1.0/organization/{id}` with `{ onPremisesSyncEnabled: false }`, i.e. `Update-MgOrganization`.

It has TWO independent requirements, and violating either returns the **exact same** opaque error:

```
403 Forbidden
Authorization_RequestDenied
"Insufficient privileges to complete the operation."
```

1. It is **delegated-only**. App-only (certificate) auth is refused no matter which app roles you hold.
2. It needs **`Organization.ReadWrite.All`**. The obvious-sounding
   `OnPremDirectorySynchronization.ReadWrite.All` does NOT cover it (that scope governs the
   `/directory/onPremisesSynchronization` feature flags, not the tenant on/off switch), and
   `Directory.ReadWrite.All` alone is not enough either.

Because the message says only "Insufficient privileges", it reads like a *role* problem. That sends you
off verifying Global Administrator membership, which is usually fine, instead of inspecting the token's
scopes. Confirmed live against a tenant where the signed-in account held Global Administrator and Hybrid
Identity Administrator as direct, active, permanent assignments and STILL got the 403.

Compounding it: `Connect-MgGraph -Scopes` **requests** scopes, it does not guarantee them. If the
Microsoft Graph Command Line Tools app lacks admin consent for a scope, sign-in can silently return a
reduced scope set. On Windows, WAM can suppress the consent prompt entirely, so you end up holding a
valid Global Admin token that simply lacks the one scope the call needs, with nothing on screen to say so.

## WRONG

```powershell
# WRONG 1: app-only / certificate auth. 403 regardless of app roles held,
# including Directory.ReadWrite.All + OnPremDirectorySynchronization.ReadWrite.All.
Connect-MgGraph -TenantId $tid -ClientId $appId -CertificateThumbprint $thumb
Invoke-MgGraphRequest -Method PATCH -Uri "/v1.0/organization/$tid" `
    -Body @{ onPremisesSyncEnabled = $false }      # -> 403 Authorization_RequestDenied

# WRONG 2: delegated as a real Global Admin, but the plausible-sounding scope.
Connect-MgGraph -TenantId $tid -Scopes 'OnPremDirectorySynchronization.ReadWrite.All','Directory.ReadWrite.All'
Update-MgOrganization -OrganizationId $tid -OnPremisesSyncEnabled:$false   # -> 403, same message

# WRONG 3: assuming the requested scopes are the granted scopes, then
# diagnosing the 403 by checking directory roles (they will look fine).
```

## RIGHT

```powershell
# Delegated, interactive, as a Global Administrator, with Organization.ReadWrite.All.
Connect-MgGraph -TenantId $tid -Scopes 'Organization.ReadWrite.All','Directory.ReadWrite.All'

# Assert the scope is actually IN THE TOKEN before the call. Fail loudly here
# rather than decoding an opaque 403 later.
$ctx = Get-MgContext
if ($ctx.AuthType -ne 'Delegated')                        { throw 'Must be delegated, not app-only.' }
if ($ctx.Scopes -notcontains 'Organization.ReadWrite.All') { throw 'Consent not granted; re-run and approve the prompt.' }

Update-MgOrganization -OrganizationId $tid -BodyParameter @{ onPremisesSyncEnabled = $false }

# Verify: the property becomes $null, NOT $false, when dirsync is off.
(Get-MgOrganization -OrganizationId $tid).OnPremisesSyncEnabled   # -> $null
```

## NOTES

- **`null` is the disabled state.** After a successful disable, `/organization` reports
  `onPremisesSyncEnabled: null`, not `false`. Do not treat a null as "unknown" or as a failed write.
- **Per-object conversion lags the tenant flag.** Immediately after the switch, user objects still
  report `onPremisesSyncEnabled: true` with `onPremisesDistinguishedName` / `onPremisesSamAccountName`
  populated. Those clear in the background. Verify at the organization level, not per user.
- **72-hour re-enable lockout.** Microsoft's doc wording is easy to misread: you must WAIT 72 hours
  before directory sync can be turned back ON. It is a recovery-time floor, not a processing delay.
- **Uninstall the sync client FIRST** if the goal is permanent. Disabling before uninstalling Connect
  Sync / Cloud Sync can leave the portal showing DirSync disabled while Password Hash Sync still shows
  enabled.
- **Check PHS before doing this at all.** With Password Hash Sync on, converted users keep their
  last-synced password and sign-in is unaffected. Without it (PTA-only), converted users have no cloud
  credential. `Get-ADSyncAADCompanyFeature` on the Connect server reports `PasswordHashSync`; from the
  tenant side `GET /beta/directory/onPremisesSynchronization` exposes `passwordSyncEnabled`, but that
  GET needs `OnPremDirectorySynchronization.Read.All` (app-only is fine for the read).
- The conversion clears `DnsDomainName`, `NetBiosName`, `OnPremisesDistinguishedName`,
  `OnPremisesSamAccountName`, `OnPremisesUserPrincipalName` on every converted object.
- If on-prem AD stays live afterward, AD password changes silently stop reaching M365 forever. Users
  keep signing in with the last-synced hash while their AD password diverges.
- Same shape as [Intune deviceManagementScripts rejects app-only tokens](intune-devicemanagementscripts-delegated-only.md):
  a delegated-only endpoint whose 403 is indistinguishable from a missing-consent 403. When app-only
  403s on a tenant-level write, test delegated before granting more app roles.
- Source: https://learn.microsoft.com/en-us/microsoft-365/enterprise/turn-off-directory-synchronization
