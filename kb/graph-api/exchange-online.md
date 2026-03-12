---
tech: graph-api
tags: [exchange-online, connect-exchangeonline, permissions, directory-roles, domain]
severity: high
---
# Exchange Online needs Exchange.ManageAsApp + Exchange Admin role + domain not GUID

## PROBLEM
Three separate gotchas that all produce different errors:
1. Graph permissions alone are not enough for Exchange Online PowerShell -- it requires both an app permission AND a directory role
2. `Connect-ExchangeOnline -Organization` requires a domain name string, not a tenant GUID
3. Missing either requirement produces different, non-obvious error messages

## WRONG
```powershell
# BAD -- Graph connection does not grant Exchange Online access
Connect-MgGraph -TenantId $tid -ClientId $cid -CertificateThumbprint $thumb
Set-Mailbox ...  # fails -- Exchange cmdlets not available via MgGraph connection

# BAD -- GUID rejected
Connect-ExchangeOnline -CertificateThumbprint $thumb -AppId $cid -Organization $tenant.tenantId
# Error: "Organization cannot be a Guid"
```

## RIGHT
```powershell
# Exchange Online requires a separate connection with its own auth
# Two requirements must BOTH be met:
# 1. Exchange.ManageAsApp app permission (resource ID: 00000002-0000-0ff1-ce00-000000000000)
# 2. Exchange Administrator directory role assigned to the service principal

# GOOD -- connect with domain name from tenants.json
Connect-ExchangeOnline `
    -CertificateThumbprint $thumb `
    -AppId $cid `
    -Organization $tenant.domain  # e.g. "contoso.onmicrosoft.com" or "contoso.com"

try {
    Set-Mailbox ...
} finally {
    Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue
}
```

## NOTES
- Error without `Exchange.ManageAsApp`: `UnAuthorized` on connect
- Error without Exchange Admin role: `The role assigned to application ... isn't supported in this scenario`
- The Exchange Administrator role cannot be self-assigned by the app (requires `RoleManagement.ReadWrite.Directory`). Assign it manually in Entra admin center: Roles and administrators -> Exchange Administrator -> Add assignment -> select the service principal.
- Every tenant entry in `tenants.json` must have a `domain` field. The `.onmicrosoft.com` domain works fine as a fallback.
- Admin accounts vary per tenant -- some use `wellforce@`, `administrator@`, `admin@`. Never construct them from the domain name; look them up.
