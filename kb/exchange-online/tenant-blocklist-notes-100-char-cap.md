---
tech: exchange-online
tags: [tenant-allow-block-list, new-tenantallowblocklistitems, blocked-senders, phishing, notes-field, character-limit, atomic-failure]
severity: medium
---
# New-TenantAllowBlockListItems -Notes caps at 100 characters and applies NO block at all

## PROBLEM

`New-TenantAllowBlockListItems -Notes` is silently capped at 100 characters. Exceeding it does not
truncate the note and does not apply the block with a shortened note. It rejects the **entire cmdlet
call**, so zero entries are created:

```
New-TenantAllowBlockListItems: ||Remove 30 characters from Notes and retry.
```

Three things make this bite harder than a normal parameter-validation error:

1. **The limit is undocumented in the cmdlet's own error surface.** There is no
   `ValidateLength` attribute you can discover with `Get-Help` or `(Get-Command ...).Parameters`.
   You only learn the cap exists by exceeding it. The error does at least tell you the exact
   overage ("Remove 30 characters"), so `currentLength - 30 = 100` is how you derive the limit.
2. **It fails atomically across `-Entries`.** `-Entries` takes an array, so a single over-long
   `-Notes` kills a batch block of 20 domains, not just one. Nothing is partially applied.
3. **This is a security control.** The natural note to write is exactly the one that blows the
   cap -- threat type, spoofed party, dollar amount, ticket number, date. A script that pipes the
   cmdlet without `-ErrorAction Stop`, or that never reads back the list, reports success while the
   malicious domain remains **fully deliverable**. You believe a phishing domain is blocked and it
   is not.

The same 100-character cap applies to `Set-TenantAllowBlockListItems -Notes`.

## WRONG

```powershell
# 130 chars of Notes -> whole call rejected, domain NOT blocked
$notes = 'BEC invoice fraud: spoofed IAFC staff (Donna Black), fake ServiceNow ACH invoice $49,465.90, SupportForge #429, blocked 2026-08-03'

New-TenantAllowBlockListItems -ListType Sender -Block `
    -Entries 'uinsure.co.uk' -NoExpiration -Notes $notes
# New-TenantAllowBlockListItems: ||Remove 30 characters from Notes and retry.

# Worse: swallow the error and never verify. Reports success, blocks nothing.
New-TenantAllowBlockListItems -ListType Sender -Block `
    -Entries $manyDomains -NoExpiration -Notes $notes -ErrorAction SilentlyContinue
Write-Host "Blocked $($manyDomains.Count) domains"   # <-- a lie
```

## RIGHT

```powershell
# Keep Notes <= 100 chars, and hard-truncate defensively rather than trusting yourself to count.
$notes = 'BEC invoice fraud, fake ServiceNow ACH invoice, SupportForge #429, blocked 2026-08-03'
if ($notes.Length -gt 100) { $notes = $notes.Substring(0, 100) }

New-TenantAllowBlockListItems -ListType Sender -Block `
    -Entries 'uinsure.co.uk' -NoExpiration -Notes $notes -ErrorAction Stop

# ALWAYS read back. A security control you did not verify is not a control.
$after = @(Get-TenantAllowBlockListItems -ListType Sender -Block | Where-Object { $_ })
if (@($after | Where-Object { $_.Value -eq 'uinsure.co.uk' }).Count -eq 0) {
    throw "Block for uinsure.co.uk was NOT applied."
}
```

## NOTES

- Derive the cap from the error rather than guessing: the message states the exact overage, so
  `$notes.Length - <N> = 100`.
- Put the long-form context (full threat description, indicators, banking details, impersonated
  party) in the ticket or the client's incident documentation. Keep `-Notes` to a terse index key:
  threat type, ticket number, date. That fits in 100 characters and is what you actually grep the
  block list for later.
- Because failure is atomic across `-Entries`, prefer one call per domain when scripting a batch,
  or validate every `-Notes` string before the loop. One bad note otherwise silently costs you the
  whole batch.
- Verifying with a read-back also protects against the unrelated replica-inconsistency trap in
  [EXO membership and permission reads are replica-inconsistent](exo-membership-reads-replica-inconsistent.md);
  for allow/block-list writes the read-back has been immediately consistent in practice, but treat a
  missing entry as "retry and re-verify", not as proof of failure.
- Related: app-only cert auth must have `Exchange.ManageAsApp` plus an Exchange admin role before
  any of these cmdlets work at all, see
  [App-only EXO connects but every cmdlet 401s](app-only-401-propagation.md).
