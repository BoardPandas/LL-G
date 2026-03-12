---
tech: graph-api
tags: [permissions, propagation, timing, admin-consent, disconnect]
severity: high
---
# New permissions take 1-15 min to propagate

## PROBLEM
After granting admin consent for a new permission, the existing Graph session token does not automatically include the new scope. The operation will continue to fail with 403 until you disconnect, reconnect, and wait for the permission to propagate.

## WRONG
```powershell
# Just granted Policy.ReadWrite.ConditionalAccess in the portal
# Trying immediately on the existing connection
$policies = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/identity/conditionalAccess/policies"
# Still 403 -- token from before the grant doesn't have the scope
```

## RIGHT
```powershell
# After granting new permissions, must disconnect and reconnect
Disconnect-MgGraph
Connect-MgGraph -TenantId $tid -ClientId $cid -CertificateThumbprint $thumb -NoWelcome

# Then poll to confirm the permission is active before proceeding
$maxWait = 300  # 5 minutes
$interval = 15
$elapsed = 0
do {
    Start-Sleep -Seconds $interval
    $elapsed += $interval
    try {
        $test = Invoke-MgGraphRequest -Method GET -Uri $testUri
        Write-Host "Permission active after ${elapsed}s"
        break
    } catch {
        if ($elapsed -ge $maxWait) {
            Write-Error "Permission not active after ${maxWait}s. Check admin consent in Azure portal."
            return
        }
        Write-Host "  Still waiting... (${elapsed}s)"
    }
} while ($true)
```

## NOTES
- App role assignments: typically 1-5 minutes
- Delegated permissions: may require a new token only (disconnect + reconnect is usually sufficient)
- Cross-tenant: up to 15 minutes in some cases
- Conditional Access permissions (`Policy.Read.All`, `Policy.ReadWrite.ConditionalAccess`) are NOT included in the standard 37-permission app registration. Must be granted separately.
