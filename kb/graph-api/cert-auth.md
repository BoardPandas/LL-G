---
tech: graph-api
tags: [authentication, certificates, cert-store, connect-mggraph]
severity: high
---
# Certificate must be in CurrentUser store

## PROBLEM
`Connect-MgGraph` with certificate-based auth looks in the store you specify. Using `LocalMachine` fails silently or with a cryptic error. Additionally, attempting to connect without first verifying the cert exists produces a confusing error rather than a clear diagnostic.

## WRONG
```powershell
# Wrong store
$cert = Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.Thumbprint -eq $thumbprint }
Connect-MgGraph -TenantId $tid -ClientId $cid -CertificateThumbprint $thumb
```

## RIGHT
```powershell
# Verify cert exists in the correct store before connecting
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Thumbprint -eq $thumb }
if (-not $cert) {
    Write-Error "Certificate $thumb not found in Cert:\CurrentUser\My. Run the deployment script first."
    return
}
Connect-MgGraph -TenantId $tid -ClientId $cid -CertificateThumbprint $thumb -NoWelcome
```

## NOTES
- Certificates are installed per-user by the deployment script. They live in `CurrentUser\My`, not `LocalMachine\My`.
- `-NoWelcome` suppresses the "Welcome to Microsoft Graph!" banner -- useful in automation.
- Verify the thumbprint matches what's in `tenants.json` before connecting.
