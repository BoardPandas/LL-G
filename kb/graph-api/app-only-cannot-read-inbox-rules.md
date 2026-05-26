---
tech: graph-api
tags: [exchange-online, inbox-rules, messagerules, app-only, application-permissions, delegated, mail]
severity: high
---
# App-only Graph cannot read inbox rules (messageRules is delegated-only)

## PROBLEM
`GET /users/{id}/mailFolders/inbox/messageRules` returns `403 Forbidden` under
app-only (application permission) auth even when the app holds `Mail.ReadWrite`.
The `messageRules` resource only supports DELEGATED permissions, so there is no
app permission that makes it work. The 403 looks like a missing-consent problem
and sends you chasing permissions that will never fix it.

## WRONG
```powershell
# App-only cert auth, app has Mail.ReadWrite (application)
Connect-MgGraph -ClientId $appId -TenantId $tid -CertificateThumbprint $thumb
# 403 Forbidden -- messageRules does not support application permissions
Invoke-MgGraphRequest -Method GET `
  -Uri "https://graph.microsoft.com/v1.0/users/$upn/mailFolders/inbox/messageRules"
```

## RIGHT
```powershell
# Read inbox rules through Exchange Online instead (app-only EXO works here)
Connect-ExchangeOnline -CertificateThumbprint $thumb -AppId $appId -Organization $domain
Get-InboxRule -Mailbox $upn | Select-Object Name, Enabled, Description,
    ForwardTo, RedirectTo, DeleteMessage, MoveToFolder
Disconnect-ExchangeOnline -Confirm:$false
```

## NOTES
- Delegated Graph (a signed-in user reading their own rules) does work; only the
  app-only path is blocked.
- This pairs with the EXO app-only requirements: the app needs
  `Exchange.ManageAsApp` + an appropriate directory role and
  `Connect-ExchangeOnline -Organization` wants the domain, not a tenant GUID.
- Common during mailbox-compromise investigations where you want to enumerate
  hidden forwarding/redirect rules without an interactive sign-in.
