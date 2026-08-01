---
tech: graph-api
tags: [app-only, offboarding, directory-roles, 403, accountEnabled, user-management]
severity: high
---
# A directory role on the TARGET user blocks app-only user writes (403)

## PROBLEM
`PATCH /users/{id}` with `accountEnabled = false` returns 403 `Authorization_RequestDenied` ("Insufficient privileges to complete the operation") when the **target** user holds an admin directory role -- Billing Administrator, Helpdesk Administrator, User Administrator, and so on. `User.ReadWrite.All` with admin consent granted is necessary but not sufficient: Entra protects role-assigned users from app-only principals that do not themselves hold an equal-or-greater role.

The error is byte-identical to the missing-consent 403, so every instinct (and most tooling hints, including Graph's own "verify consent in the Entra admin center") sends you back to the app registration, where everything looks correct. Nothing in the error names the role, or even tells you the problem is with the target rather than the caller.

The dangerous shape is a bulk offboarding loop: nineteen users disable cleanly and the twentieth -- the one who happened to be a Billing Admin -- silently stays enabled. If you are not checking each result individually, you ship an offboarding that left an administrator's account live.

## WRONG
```powershell
# Bulk disable; the role-holding user 403s and gets lost in the noise
foreach ($id in $userIds) {
    Invoke-MgGraphRequest -Method PATCH -Uri "https://graph.microsoft.com/v1.0/users/$id" `
        -Body (@{ accountEnabled = $false } | ConvertTo-Json) -ContentType 'application/json'
}
# 403 Authorization_RequestDenied -> you go re-verify admin consent.
# Consent is fine. It was never consent.
```

## RIGHT
```powershell
# Check the TARGET for directory roles before assuming a caller-permissions problem
$memberOf = @((Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/users/$id/memberOf" -OutputType PSObject).value)
$roles = @($memberOf | Where-Object { $_.'@odata.type' -eq '#microsoft.graph.directoryRole' })

if ($roles.Count -gt 0) {
    Write-Warning "$id holds: $(($roles.displayName) -join ', '). App-only PATCH will 403 until the role is removed."

    # Remove the role assignment FIRST (needs RoleManagement.ReadWrite.Directory),
    # then the accountEnabled PATCH succeeds.
    Invoke-MgGraphRequest -Method DELETE `
        -Uri "https://graph.microsoft.com/v1.0/directoryRoles/$($roles[0].id)/members/$id/`$ref"
}

Invoke-MgGraphRequest -Method PATCH -Uri "https://graph.microsoft.com/v1.0/users/$id" `
    -Body (@{ accountEnabled = $false } | ConvertTo-Json) -ContentType 'application/json'
```

## NOTES
- Stripping a departing user's directory role is good hygiene regardless, so this is rarely an unwanted extra step -- but it is a **privileged escalation**, so gate it behind whatever change-authorization process you use.
- Role removal needs `RoleManagement.ReadWrite.Directory`; `Directory.ReadWrite.All` is not enough (see assign-sp-to-role-needs-rolemanagement-readwrite.md).
- If you cannot remove the role, disabling the account through the portal under a human admin identity is the fallback. Disabling does neutralize the role in practice.
- Watch the inverse trap: removing the last holder can leave the role with **zero** members tenant-wide. Check afterwards and reassign if the role matters (Billing Administrator being the common one).
- Related: 403-admin-consent.md -- the case this is constantly mistaken for. Also principal-cannot-remove-self-from-role.md.
