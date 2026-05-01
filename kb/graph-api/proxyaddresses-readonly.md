---
tech: graph-api
tags: [exchange-online, proxyaddresses, mailbox-aliases, set-mailbox, smtp]
severity: high
---
# proxyAddresses is read-only via Graph for mail-enabled users

## PROBLEM

It seems natural to PATCH `/users/{id}` with a new `proxyAddresses` collection to add or remove email aliases on an M365 user. This silently looks like the right shape -- the property is returned by GET, the user object schema lists it as writable, and PATCH on other user properties (UPN, displayName, mailNickname, password) works fine.

It fails: as soon as the user is mail-enabled (has an Exchange Online mailbox), Graph rejects writes to `proxyAddresses` with:

```
400 Request_BadRequest
"Property 'proxyAddresses' is read-only and cannot be set."
```

Exchange Online is the master of `proxyAddresses` for mailbox-enabled users; Graph mirrors it but cannot write it. This is not documented prominently and there's no Graph-side workaround. You must use Exchange Online's `Set-Mailbox` cmdlet to add or remove SMTP aliases.

The trap: changing `mailNickname` via Graph DOES work and DOES auto-flip the primary SMTP (the `SMTP:` uppercase entry), so a script that renames a user appears to succeed -- but any old SMTP aliases stay attached as secondary `smtp:` aliases and the script has no clean way to drop them via Graph.

## WRONG

```powershell
# Trying to remove the old smtp:alan@jwv.org alias via Graph -- 400 Bad Request
$body = @{
    proxyAddresses = @("SMTP:nationaladjutant@jwv.org")
} | ConvertTo-Json
Invoke-MgGraphRequest -Method PATCH `
    -Uri "https://graph.microsoft.com/v1.0/users/$userId" `
    -Body $body -ContentType "application/json"
# {"error":{"code":"Request_BadRequest","message":"Property 'proxyAddresses' is read-only and cannot be set."}}
```

## RIGHT

```powershell
# Use Exchange Online (cert-based auth requires Exchange.ManageAsApp + Exchange Admin role)
Connect-ExchangeOnline -CertificateThumbprint $tenant.certThumbprint `
    -AppId $tenant.appId -Organization $tenant.domain -ShowBanner:$false

# Remove a secondary alias
Set-Mailbox -Identity "nationaladjutant@jwv.org" `
    -EmailAddresses @{Remove = "smtp:alan@jwv.org"}

# Or add a new alias
Set-Mailbox -Identity "nationaladjutant@jwv.org" `
    -EmailAddresses @{Add = "smtp:adjutant@jwv.org"}

# Or change the primary (uppercase SMTP wins)
Set-Mailbox -Identity "nationaladjutant@jwv.org" `
    -WindowsEmailAddress "nationaladjutant@jwv.org"
```

Verify with `Get-Mailbox <identity> | Select PrimarySmtpAddress, EmailAddresses`.

## NOTES

- Casing matters in `EmailAddresses` entries: `SMTP:` (uppercase) is the primary, `smtp:` (lowercase) is a secondary alias. There can be only one `SMTP:` per mailbox.
- Graph API CAN update `mailNickname`, which auto-flips the primary SMTP for cloud-only mailboxes. So renames work end-to-end via Graph + EXO together: Graph for UPN/displayName/names/mailNickname/password, EXO for cleaning up stale aliases.
- For DirSync-synced users this gets worse: see `dirsync-blocks-cloud-writes.md` -- `proxyAddresses` is mastered on-prem and even EXO cannot write it; you must edit `proxyAddresses` in on-prem AD and wait for sync.
- Same restriction applies to `mail`, `mailEnabled`, and other Exchange-mastered fields on mail-enabled users.
- This is the workaround pattern when Graph SDK module versions conflict (see `graph-module-version-mismatch.md`): use `Invoke-MgGraphRequest` for everything Graph supports, then drop into `ExchangeOnlineManagement` for the mailbox-only operations.
