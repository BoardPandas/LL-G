---
tech: exchange-online
tags: [exchange-online, powershell, app-only, certificate-auth, exchange.manageasapp, device-code, http-401, get-exomailbox, propagation]
severity: medium
---
# App-only EXO connects but every cmdlet 401s (role propagation); Get-Mailbox hides it as a GetResponseHeader error

## PROBLEM
App-only certificate `Connect-ExchangeOnline` can succeed (`Get-ConnectionInformation` shows `tokenStatus=Active`, correct `AppId`/`Organization`) yet EVERY cmdlet returns **HTTP 401**. This happens when `Exchange.ManageAsApp` (app role) and the **Exchange Administrator** directory role are assigned in Entra but not yet effective in Exchange's RBAC. Propagation can take up to ~60 min, and sometimes the assignment never becomes effective and needs separate investigation. The tell is **401, not 403**: the token's roles claim isn't being honored by Exchange (an authentication/identity rejection), not an authorization-scope shortfall.

Worse, the legacy RPS-style cmdlets mask the 401 with a misleading error:
`Method invocation failed because [System.Net.Http.HttpResponseMessage] does not contain a method named 'GetResponseHeader'.`
This is NOT a module bug or version mismatch (seen on ExchangeOnlineManagement 3.10.0 / PowerShell 7.6.2) -- it is the cmdlet's error formatter choking while trying to render the underlying HTTP failure. You waste time chasing a phantom module problem instead of seeing the real 401.

## WRONG
```powershell
# App-only cert auth: connects fine, then every cmdlet dies with a cryptic error
Connect-ExchangeOnline -CertificateThumbprint $thumb -AppId $appId -Organization $domain -ShowBanner:$false
Get-Mailbox -RecipientTypeDetails RoomMailbox
# -> "does not contain a method named 'GetResponseHeader'"  (this is a masked HTTP 401)
# Reaction: update/reinstall the module, retry endlessly, blame ExchangeOnlineManagement. None of that helps.
```

## RIGHT
```powershell
# 1) Surface the REAL error with REST-native Get-EXO* cmdlets:
Get-EXOMailbox -RecipientTypeDetails RoomMailbox -ResultSize 1
# -> "Error while querying REST service. HttpStatusCode=401"  (now you know: roles not effective yet)

# 2) Unblock immediately with DELEGATED device-code auth instead of app-only.
#    Delegated admin rights are effective instantly -- no app-role propagation wait.
$canDevice = (Get-Command Connect-ExchangeOnline).Parameters.ContainsKey('Device')  # EXO module v3+
if ($canDevice) {
    Connect-ExchangeOnline -Device -ShowBanner:$false   # prints a code; sign in as a Global/Exchange admin
} else {
    Connect-ExchangeOnline -UserPrincipalName admin@tenant.onmicrosoft.com  # browser fallback
}
Get-EXOMailbox -RecipientTypeDetails RoomMailbox   # works now
```

## NOTES
- 401 vs 403 is the key signal: 401 = token/roles not honored (propagation or uneffective assignment); 403 = authenticated but lacks the specific scope.
- Device-code flow blocks waiting for the code; in a non-interactive/agent shell, launch it in the background and relay the printed code, then poll for completion.
- A benign `MsalRuntimeException: AccountNotFound` can print during `Disconnect-ExchangeOnline` token-cache cleanup AFTER the work finished (exit 0) -- cosmetic, ignore.
- If app-only must work long-term, confirm both the `Exchange.ManageAsApp` app-role assignment AND an effective Exchange admin directory role on the service principal, then wait/recheck; re-granting when already present is a no-op.
