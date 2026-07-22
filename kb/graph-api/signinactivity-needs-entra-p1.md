---
tech: graph-api
tags: [signinactivity, auditlogs, entra-p1, licensing, 403, offboarding, reporting]
severity: medium
---
# signInActivity 403s on non-premium tenants (licensing gate, not admin consent)

## PROBLEM
`GET /users?$select=signInActivity` and `GET /auditLogs/signIns` return HTTP 403 with:

```
Authentication_RequestFromNonPremiumTenantOrB2CTenant
"Tenant is not a B2C tenant and doesn't have premium license"
```

This is a **licensing** gate, not a permissions problem. Sign-in activity and the sign-in logs require Entra ID P1 or P2. Tenants running only Microsoft 365 Business Basic and/or Business Standard, common for small nonprofits and SMB clients, do not have it. (Business Premium *does* include P1, so the same script can work at one client and fail at the next.)

The trap is that every 403 instinct points at consent. You hold `AuditLog.Read.All`, admin-consented, so you go re-verify consent in the Entra portal, wait out propagation, re-grant, and re-test. None of it helps, because the permission was never the issue. Generic Graph guidance and most tooling hints say "403 usually means missing admin consent," which actively sends you the wrong direction. The error string is the only tell, and it is easy to skim past.

## WRONG
```powershell
# On a Business Standard-only tenant this 403s no matter what permissions you hold
$u = Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/beta/users/$userId`?`$select=displayName,signInActivity" `
    -OutputType PSObject
$lastSignIn = $u.signInActivity.lastSignInDateTime

# ...followed by an hour of re-granting AuditLog.Read.All that changes nothing.
```

## RIGHT
```powershell
# Detect the licensing gate explicitly and fall back, rather than chasing consent
try {
    $u = Invoke-MgGraphRequest -Method GET `
        -Uri "https://graph.microsoft.com/beta/users/$userId`?`$select=displayName,signInActivity" `
        -OutputType PSObject
    $lastSignIn = $u.signInActivity.lastSignInDateTime
} catch {
    if ($_.Exception.Message -match 'NonPremiumTenantOrB2CTenant') {
        Write-Warning "Tenant lacks Entra ID P1 -- signInActivity unavailable. Using mailbox activity instead."
        $stats = Get-MailboxStatistics -Identity $upn
        $lastSignIn = $stats.LastUserActionTime   # NOT LastLogonTime -- see notes
    } else {
        throw
    }
}
```

## NOTES
- Check entitlement up front with `GET /subscribedSkus` and look for the `AAD_PREMIUM` / `AAD_PREMIUM_P2` service plans, or the bundling SKUs (`SPB` Business Premium, `SPE_E3`, `SPE_E5`).
- The fallback choice matters. `Get-MailboxStatistics` `LastLogonTime` is bumped by background mailbox assistants and can read as "today" for an account nobody has touched in weeks. `LastUserActionTime` reflects genuine user activity. Using `LastLogonTime` to decide whether a departed employee accessed their mailbox after their last day produces a false positive and can trigger a needless security escalation.
- The same gate applies to Identity Protection endpoints (`/identityProtection/riskyUsers`, `riskDetections`).
- Unrelated quirk on the same endpoint family, worth knowing while you are there: on beta `/auditLogs/signIns`, a `$select` that includes `authenticationDetails` returns HTTP 400. Omit `$select` and read the full records.
