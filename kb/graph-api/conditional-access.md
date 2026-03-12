---
tech: graph-api
tags: [conditional-access, permissions, sign-in-logs, mfa]
severity: medium
---
# Conditional Access operations require extra permissions

## PROBLEM
Standard app registrations don't include Conditional Access scopes. Attempting to read or modify CA policies returns 403. Sign-in log `appliedConditionalAccessPolicies` is also empty without `Policy.Read.All`.

## WRONG
```powershell
# Assumes standard permissions can read CA policies -- 403
$policies = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/identity/conditionalAccess/policies"

# Sign-in logs show CA details are redacted without Policy.Read.All
$signIn = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/auditLogs/signIns/$signInId"
$signIn.appliedConditionalAccessPolicies  # Empty array!
```

## RIGHT
```powershell
# 1. Grant Policy.Read.All and Policy.ReadWrite.ConditionalAccess to your SP
# 2. MUST disconnect and reconnect -- existing token won't have new scopes
Disconnect-MgGraph
Connect-MgGraph -TenantId $tid -ClientId $cid -CertificateThumbprint $thumb -NoWelcome

# 3. Now CA endpoints work
$policies = Invoke-MgGraphRequest -Method GET -Uri "/v1.0/identity/conditionalAccess/policies"

# When PATCHing, send full conditions.users object (see ca-policy-patch.md)
```

## NOTES
- Common CA error codes in sign-in logs: **53003** (blocked by CA), **50076** (MFA required), **530003** (device not compliant)
- User-facing message "You cannot access this right now" = error code 53003 = CA block, not a password/account issue
- Even with `AuditLog.Read.All`, CA policy details inside sign-in logs are redacted without `Policy.Read.All`
- See also `ca-policy-patch.md` for safe PATCH patterns
