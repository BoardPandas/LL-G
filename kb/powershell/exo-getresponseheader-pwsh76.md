---
tech: powershell
tags: [exchange-online, exchangeonlinemanagement, pwsh7, get-mailbox, rest-cmdlets, module-version]
severity: high
---
# ExchangeOnlineManagement 3.10.0 cmdlets fail on PowerShell 7.6+ with GetResponseHeader error

## PROBLEM
With ExchangeOnlineManagement 3.10.0 loaded under PowerShell 7.6+ (.NET 9 runtime), `Connect-ExchangeOnline` succeeds but the first REST-backed cmdlet (`Get-Mailbox`, `Get-RecipientPermission`, etc.) throws:

```
Method invocation failed because [System.Net.Http.HttpResponseMessage] does not contain a method named 'GetResponseHeader'.
```

The module's internal HTTP response handling calls `GetResponseHeader`, a method that no longer exists on the newer .NET `HttpResponseMessage`. The connection looks healthy, so the error is misleading: it surfaces on the cmdlet, not the connect, making it look like a permissions or identity problem when it is purely a module/runtime incompatibility. It is made worse when two module versions are installed side by side (e.g. 3.9.2 and 3.10.0): `Import-Module ExchangeOnlineManagement` with no version auto-loads the highest (broken) one.

## WRONG
```powershell
# Auto-loads highest installed version (3.10.0) -> breaks on PS 7.6+
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -CertificateThumbprint $tp -AppId $appId -Organization $org -ShowBanner:$false
Get-Mailbox -Identity "shared@contoso.com"   # throws GetResponseHeader error
```

## RIGHT
```powershell
# Pin the import to the known-good 3.9.2 build
Import-Module ExchangeOnlineManagement -RequiredVersion 3.9.2 -ErrorAction Stop
Connect-ExchangeOnline -CertificateThumbprint $tp -AppId $appId -Organization $org -ShowBanner:$false
Get-Mailbox -Identity "shared@contoso.com"   # works
```

## NOTES
- Confirmed on PowerShell 7.6.2 with EXO 3.10.0; pinning to 3.9.2 resolved it.
- Avoid leaving multiple EXO versions installed. If you must, always pass `-RequiredVersion` so you do not silently pick up the broken build.
- Distinct from [exo-module-version-shadowing.md], which is about a stale EXO 2.x in the user module path shadowing 3.x and causing WinRM errors. This one is a 3.10.0 regression on new .NET runtimes, not a path-shadowing issue.
- If a future EXO build (>3.10.0) restores compatibility with PS 7.6+, prefer the newest fixed version over pinning to 3.9.2.
