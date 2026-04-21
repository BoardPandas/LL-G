---
tech: graph-api
tags: [permissions, service-principal, app-roles, consent, tenant-provisioning]
severity: high
---
# Stale Microsoft Graph service principal missing newer app role definitions

## PROBLEM
When registering a new app in an older tenant, admin consent fails for some permissions with `Claim is invalid: <GUID> does not exist on resource application 00000003-0000-0000-c000-000000000000` -- from the portal, `New-MgServicePrincipalAppRoleAssignment`, or the Graph REST API. The permissions ARE listed correctly in the app registration's `requiredResourceAccess`, and the IDs ARE valid Microsoft Graph app roles, but the tenant's Microsoft Graph service principal does not know about them.

Root cause: Microsoft publishes new Graph app roles over time, but does NOT auto-backfill them onto existing tenants' Graph service principals. An older tenant's Graph SP can be missing newer app roles (e.g., 674 roles vs 690+ on a fresh tenant), so consent fails for anything defined after the SP was first provisioned. Symptoms are identical across portal, CLI, and SDK because they all call the same consent endpoint.

## WRONG
```powershell
# Assumes every Graph app role ID is valid in every tenant -- it isn't
$perms = @('Directory.ReadWrite.All', 'Sites.ReadWrite.All', 'GroupMember.ReadWrite.All')
foreach ($p in $perms) {
    New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -Body @{
        PrincipalId = $sp.Id
        ResourceId  = $graphSp.Id
        AppRoleId   = $permissionIds[$p]
    }
}
# Some fail with "Permission being assigned was not found on application"
```

## RIGHT
```powershell
# Diagnose: check whether each app role ID actually exists on THIS tenant's Graph SP
$graphSp = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'" -Top 1
Write-Host "Graph SP app roles on this tenant: $($graphSp.AppRoles.Count)"

$desired = @{
    'Directory.ReadWrite.All' = '19dbc75e-c2e2-444c-a770-ec596d67a398'
    'Sites.ReadWrite.All'     = '89fe6a52-be36-487e-b7d8-d061c450a026'
    # ...
}

$available = @{}
$missing   = @{}
foreach ($name in $desired.Keys) {
    $id = $desired[$name]
    if ($graphSp.AppRoles | Where-Object { $_.Id -eq $id }) {
        $available[$name] = $id
    } else {
        $missing[$name] = $id
    }
}

if ($missing.Count -gt 0) {
    Write-Warning "Graph SP on this tenant is missing $($missing.Count) app roles:"
    $missing.Keys | ForEach-Object { Write-Warning "  $_" }
}

# Only request consent for roles that actually exist on this tenant's Graph SP
foreach ($name in $available.Keys) {
    New-MgServicePrincipalAppRoleAssignment -ServicePrincipalId $sp.Id -Body @{
        PrincipalId = $sp.Id
        ResourceId  = $graphSp.Id
        AppRoleId   = $available[$name]
    }
}
```

## NOTES
- Diagnostic check: compare the tenant's Graph SP `AppRoles.Count` to a known-current tenant. Significantly lower (e.g., 674 vs 690+) signals a stale SP.
- Portal behavior: the "Grant admin consent" button shows missing-role permissions by GUID only (no friendly name) while known ones show a friendly name. The GUID-only rows will fail on consent.
- App registration is unaffected: the permissions stay in `requiredResourceAccess` correctly. The failure is purely on the consent path.
- Two fixes for missing roles on a tenant:
  1. SAFE: drop the unavailable permissions from the app registration. Keep the core set. This is almost always the right call for a new cert-based auth setup.
  2. RISKY: delete and recreate the Microsoft Graph service principal to force Entra to pull the latest role manifest. Wipes every existing app role assignment in the tenant for every app that uses Graph. Do not do this on a live production tenant without a maintenance window.
- Microsoft support can refresh the Graph SP on a tenant via an internal tool if the missing roles are business-critical. Open a ticket.
- This is not the same as "admin consent not granted yet" (403 after consent) -- that is covered in `403-admin-consent.md`. The error text is different: "Claim is invalid" / "Permission being assigned was not found on application" vs a generic 403.
