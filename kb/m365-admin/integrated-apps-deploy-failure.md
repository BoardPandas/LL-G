---
tech: m365-admin
tags: [integrated-apps, office-addins, centralized-deployment, m365-admin-center, appsource, unified-manifest, pim, troubleshooting]
severity: medium
---
# "Integrated Apps -> Deployment failed" with no Entra audit trail: the failure is upstream of Entra

## PROBLEM
Deploying an Office add-in via M365 admin center -> Settings -> Integrated apps shows a bare "Deployment failed" with no detail. The instinct is to chase Entra consent / app permissions / RBAC. But if the Entra **directory audit log has zero `ApplicationManagement` events** for the attempt (no "Add service principal", no "Consent to application"), the deployment never reached Entra at all - it failed earlier, in Microsoft's add-in **manifest extraction / validation backend**. Consent, user-consent policy, and app permissions are then all red herrings.

Common real causes when there is no audit trail:
- The add-in uses the newer **Unified Manifest** (JSON, Teams-style) rather than the legacy XML manifest, and the Centralized Deployment backend fails to extract it (older add-ins from the same publisher deploy fine - they use XML).
- The deploying admin holds a **PIM-activated** privileged role. Centralized Deployment does not support PIM-activated roles; you need a *permanently active* assignment, or the Exchange "Org Marketplace Apps" (Store add-ins) / "Org Custom Apps" (sideloaded) management role assigned **Regular**, not Delegating.
- A genuine Microsoft service-side incident (check Service Health for "Microsoft 365 suite" / "add-ins").

## WRONG
```powershell
# Symptom: Integrated Apps UI says "Deployment failed", no detail.
# Wrong move: assume it is an Entra consent / permissions problem and start
# editing the app registration, granting admin consent, loosening user-consent
# policy, etc. None of that helps if Entra was never involved.
Get-MgPolicyAuthorizationPolicy        # ...chasing the wrong layer
Update-MgApplication -RequiredResourceAccess ...   # pointless here
```

## RIGHT
```powershell
# 1. Confirm where the failure actually is: check the Entra directory audit log.
Connect-MgGraph -Scopes "AuditLog.Read.All" -NoWelcome
$since = ([DateTime]::UtcNow.AddDays(-1)).ToString("yyyy-MM-ddTHH:mm:ssZ")
@(Get-MgAuditLogDirectoryAudit -Filter "activityDateTime ge $since and category eq 'ApplicationManagement'" -Top 50) |
    Select-Object ActivityDateTime, ActivityDisplayName, Result,
        @{n='Target';e={($_.TargetResources | Select-Object -First 1).DisplayName}}
# Zero events for your add-in => failure is upstream of Entra. Stop touching Entra.

# 2. Get a more specific error from the dedicated cmdlet (same backend, better message).
Install-Module O365CentralizedAddInDeployment -Scope CurrentUser -Force   # may need Windows PowerShell
Import-Module O365CentralizedAddInDeployment
Connect-OrganizationAddInService
Get-OrganizationAddIn   # shows AssetIds of already-deployed Store add-ins
# AssetId for an AppSource add-in is in its marketplace URL: .../product/office/wa200010453 -> WA200010453
New-OrganizationAddIn -AssetId "WA200010453" -Members "user@contoso.com"
# e.g. "Extracting Add-In's manifest... Unable to extract Add-In's details."
# -> manifest extraction failure (often Unified Manifest); this is a Microsoft-side bug, open a support case.

# 3. Rule out the supported causes you CAN fix:
#    - Is your privileged role PIM-activated? Need a permanent assignment instead.
Connect-MgGraph -Scopes "RoleManagement.Read.Directory" -NoWelcome
$uid = (Get-MgUser -UserId user@contoso.com).Id
@(Get-MgRoleManagementDirectoryRoleAssignmentScheduleInstance -Filter "principalId eq '$uid'" -ExpandProperty roleDefinition) |
    Select-Object @{n='Role';e={$_.RoleDefinition.DisplayName}}, AssignmentType, EndDateTime
#    AssignmentType 'Activated' = PIM-activated (unsupported). 'Assigned' + no EndDateTime = permanent (fine).
#    - Exchange role present and Regular?
Get-ManagementRoleAssignment -Role "Org Marketplace Apps" -GetEffectiveUsers |
    Select-Object EffectiveUserName, RoleAssignmentDelegationType

# Workaround while a backend bug is open: users self-install from the Office Store
# inside the app (Insert -> Get Add-ins -> Store). Functions identically; not centrally managed.
```

## NOTES
- `AppsForOfficeEnabled` (from `Get-OrganizationConfig`) is the org-wide add-ins master switch - if `False`, *every* add-in deploy fails (different symptom: it usually fails fast and obviously). Verify it is `True` before going down the manifest-extraction path.
- `EwsEnabled = False` on the tenant does **not** block add-in deployment, but it will break Outlook mailbox add-ins (incl. Claude for Outlook) at runtime - they use the EWS-backed mailbox API. Worth flagging separately.
- Real-world case: Wellforce LLC, May 2026 - Claude for Excel (WA200009404) and PowerPoint (WA200010001) deployed fine (legacy XML manifest); Claude for Word (WA200010453) and Outlook failed identically from both the portal and `New-OrganizationAddIn` with no Entra activity; admin was a permanent (non-PIM) Global Administrator; root cause was Microsoft's backend choking on the newer Unified Manifest. MS support case 2605110040008355.
