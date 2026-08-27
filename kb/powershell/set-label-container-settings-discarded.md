---
tech: powershell
tags: [purview, sensitivity-labels, set-label, container-labels, app-only-auth, exchange-online, ipps, silent-failure]
severity: high
---
# Set-Label silently discards container protection settings

## PROBLEM
`Set-Label` and `New-Label` (Security & Compliance PowerShell, `Connect-IPPSSession`)
accept the container-protection parameters but under certificate app-only auth they
**return success and store nothing**:

- `-SiteAndGroupProtectionPrivacy`
- `-SiteAndGroupProtectionAllowAccessToGuestUsers`
- `-SiteAndGroupProtectionAllowLimitedAccess`
- `-SiteAndGroupProtectionBlockAccess`
- `-SiteExternalSharingControlType`

No error, no warning, exit code 0. The label's scope widens correctly (`contenttype`
becomes `Site, UnifiedGroup`) which makes it look like the call worked, but the
protection settings are gone.

The verification trap is worse than the bug. `Get-Label` returns **no**
`SiteAndGroupProtection*` properties at all, and `$label.Settings` contains only
`parentid` / `contenttype` / `tooltip` / `isparent` / `displayname`. So the obvious
check -- reading back the property you just set -- returns blank whether the setting
applied or not. The same is true of `$label.EncryptionEnabled`, which reads blank even
when encryption **is** correctly applied.

Confirmed across four attempts that all failed identically: on a sublabel; on a
dedicated top-level container-only label; after setting `EnableMIPLabels = True` in the
`Group.Unified` directory setting; and after adding `-AddModernGroupLocation All` to the
publishing policy. Setting the identical values in the Purview portal worked on the
first attempt.

## WRONG
```powershell
Set-Label -Identity 'WF-Workspace-Confidential' `
    -SiteAndGroupProtectionPrivacy 'private' `
    -SiteAndGroupProtectionAllowAccessToGuestUsers $true `
    -SiteExternalSharingControlType 'ExistingExternalUserSharingOnly' `
    -ErrorAction Stop
# returns success, stores nothing

# and this "verification" passes vacuously - the property does not exist either way
$l = Get-Label -Identity 'WF-Workspace-Confidential'
if ($null -eq $l.SiteAndGroupProtectionPrivacy) { 'not set' } else { 'set' }
```

## RIGHT
```powershell
# Set container protection in the Purview portal:
#   Information Protection > Sensitivity labels > Edit label
#   > Scope: tick "Groups & sites" > Groups & sites
#   > Define protection settings: tick BOTH
#       "Privacy and external user access settings"
#       "External sharing and Conditional Access"
#   (the Conditional Access box is what carries the unmanaged-device control)

# Then verify from PowerShell via LabelActions - the ONLY reliable read:
$l = Get-Label -Identity 'WF-Workspace-Confidential'
$types = @($l.LabelActions | ForEach-Object { ($_ | ConvertFrom-Json).Type })

if ($types -notcontains 'protectgroup' -or $types -notcontains 'protectsite') {
    throw "Container protection NOT applied on $($l.DisplayName) - found: $($types -join ',')"
}
$l.LabelActions | Where-Object { $_ -match 'protectgroup|protectsite' }
# {"Type":"protectgroup","Settings":[{"Key":"privacy","Value":"private"},...]}
# {"Type":"protectsite","Settings":[{"Key":"allowlimitedaccess","Value":"true"},...]}
```

## NOTES
- `LabelActions` is where **all** real label configuration lives -- container protection
  (`protectgroup`, `protectsite`), encryption (`encrypt`), watermarks
  (`applywatermarking`) and headers/footers (`applycontentmarking`). Top-level
  properties on the object are decorative. Never assert a label is configured by
  reading a top-level property.
- Prerequisite regardless of method: `EnableMIPLabels` must be `True` in the
  `Group.Unified` directory setting (Graph: `PATCH /groupSettings/{id}`), and the
  publishing policy needs `-AddModernGroupLocation All`. Neither one makes the
  PowerShell path work, but without them container labels never surface on
  Teams/Groups/sites at all.
- Container label changes can take up to 24 hours to appear when creating a
  Team or site. Do not judge success by an immediate test.
- Not verified whether delegated (interactive) auth behaves differently; the failure
  was reproduced only under app-only certificate auth.
