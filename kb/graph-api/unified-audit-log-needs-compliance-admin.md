---
tech: graph-api
tags: [exchange-online, unified-audit-log, search-unifiedauditlog, compliance-administrator, rbac, app-only, directory-roles]
severity: high
---
# Search-UnifiedAuditLog (app-only EXO) needs the Compliance Administrator role, not Global Reader

## PROBLEM
Running `Search-UnifiedAuditLog` over app-only Exchange Online requires the app's
service principal to hold the **Compliance Administrator** directory role. With
only **Global Reader**, `Connect-ExchangeOnline` still succeeds, but the
`Search-UnifiedAuditLog` cmdlet is simply ABSENT from the session: you get
`The term 'Search-UnifiedAuditLog' is not recognized`. The cmdlet surface that an
app-only EXO session exposes is gated by the assigned RBAC role, so a missing
cmdlet means "wrong role," not "wrong module version." This wastes time because
the natural assumption is a module/import problem.

## WRONG
```powershell
# App SP granted Exchange.ManageAsApp + admin consent, then put in Global Reader.
Connect-ExchangeOnline -CertificateThumbprint $thumb -AppId $appId -Organization $domain
# CommandNotFoundException -- the cmdlet isn't in the session at all
Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-7) -EndDate (Get-Date)
```

## RIGHT
```powershell
# Prereqs (in order):
#   1. Grant the app Exchange.ManageAsApp (application) + admin consent.
#   2. Assign the app's SP the *Compliance Administrator* directory role
#      (Global Reader is NOT sufficient for the audit-log cmdlets).
Connect-ExchangeOnline -CertificateThumbprint $thumb -AppId $appId -Organization $domain
Get-Command Search-UnifiedAuditLog   # now present
Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-7) -EndDate (Get-Date) `
    -Operations MailItemsAccessed -ResultSize 5000
```

## NOTES
- The same gating applies to other compliance cmdlets; if a cmdlet you expect is
  missing from an app-only EXO session, suspect the directory role first.
- Reassigning the role does not take effect on an existing session: disconnect,
  wait for propagation (minutes), and reconnect.
