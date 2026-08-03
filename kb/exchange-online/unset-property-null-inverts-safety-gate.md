---
tech: exchange-online
tags: [inbox-rules, safety-gate, null, strictmode, get-mailboxpermission, get-recipientpermission, guard-clause, exo]
severity: high
---
# An unset EXO property is $null, so counting it inverts the safety gate you wrote to protect yourself

## PROBLEM

`get-inboxrule-null-count.md` documents EXO **cmdlets** returning a literal `$null`
instead of an empty collection. The same shape exists one level down, on the
**properties of returned objects**, and it is more dangerous there because that is where
people write guard clauses.

An inbox rule that forwards nothing does not carry an empty `ForwardTo` collection. It
carries `$null`. So the obvious guard:

```powershell
if (@($r.ForwardTo).Count -gt 0) { <# this rule sends mail elsewhere #> }
```

is **true for every rule in existence**, because `@($null).Count` is `1`.

The failure direction is what matters. A gate written this way reports "this rule forwards
mail" about rules that do nothing of the kind, so it blocks safe work and trains whoever
hits it to disable the gate or work around it. Invert the comparison -- and
`-eq 0` reads just as natural in a guard -- and it silently *approves* a rule that really
does forward, which is the version that leaks mail. Either way the gate is not measuring
what its author believed, and because a guard clause is precisely the code you stop
questioning, it can sit wrong indefinitely.

Observed 2026-08-03 gating a `DeliverToMailboxAndForward` change: all four rules on the
mailbox were pure move-to-folder with `DeleteMessage=False` and every forward property
blank, and the gate refused the change claiming all four forwarded mail.

The same `$null` also comes back from **permission reads scoped to a principal who has no
permission** -- `Get-MailboxPermission -User`, `Get-RecipientPermission -Trustee` -- where
under `Set-StrictMode -Version Latest` the pipeline dies with a message that names a
property rather than the real cause:

```
The property 'AccessRights' cannot be found on this object.
```

## WRONG

```powershell
# "Refuse to restore local delivery if any inbox rule sends mail elsewhere."
# Trips on EVERY rule, including rules that only move mail to a folder.
$unsafe = @()
foreach ($r in @(Get-InboxRule -Mailbox $mbx | Where-Object { $null -ne $_ })) {
    if (@($r.ForwardTo).Count             -gt 0) { $unsafe += $r.Name }
    if (@($r.RedirectTo).Count            -gt 0) { $unsafe += $r.Name }
    if (@($r.ForwardAsAttachmentTo).Count -gt 0) { $unsafe += $r.Name }
}
if ($unsafe.Count -gt 0) { throw "ABORT: rules forward mail: $($unsafe -join ', ')" }

# Same bug, and this one fails OPEN:
$fa = @(Get-MailboxPermission -Identity $mbx -User $who |
    Where-Object { $_.AccessRights -contains 'FullAccess' })   # StrictMode throws here
```

## RIGHT

```powershell
# Drop the $null before counting. A helper keeps it honest everywhere.
function ConvertTo-SafeArray {
    param([Parameter(ValueFromPipeline)] $InputObject)
    process { if ($null -ne $InputObject) { $InputObject } }
}

$unsafe = @()
foreach ($r in @(Get-InboxRule -Mailbox $mbx | ConvertTo-SafeArray)) {
    $fwd = @($r.ForwardTo             | ConvertTo-SafeArray)
    $red = @($r.RedirectTo            | ConvertTo-SafeArray)
    $att = @($r.ForwardAsAttachmentTo | ConvertTo-SafeArray)

    if ($r.DeleteMessage -eq $true -or
        $fwd.Count -gt 0 -or $red.Count -gt 0 -or $att.Count -gt 0) {
        $unsafe += $r.Name
    }
}

# Permission reads, StrictMode-safe:
$fa = @(Get-MailboxPermission -Identity $mbx -User $who -ErrorAction SilentlyContinue |
    ConvertTo-SafeArray |
    Where-Object { $_.AccessRights -contains 'FullAccess' -and -not $_.IsInherited })
```

Then prove the gate discriminates, in both directions, before trusting it:

```powershell
# A gate that has never returned BOTH answers has not been tested.
#   - point it at a mailbox with a known forwarding rule  -> must block
#   - point it at a mailbox with only move-to-folder rules -> must allow
```

## NOTES

- Any EXO property that is "a collection when populated" is `$null` when empty. Seen on
  `ForwardTo`, `RedirectTo`, `ForwardAsAttachmentTo`, `GrantSendOnBehalfTo`, `ManagedBy`,
  `AcceptMessagesOnlyFrom`, `ModeratedBy` and `EmailAddresses`. Treat the shape as the
  default across the cmdlet surface rather than enumerating exceptions.
- `-contains` on `$null` is safe (`$null -contains 'x'` is `$false`), so testing membership
  is preferable to testing `.Count` whenever it expresses the same intent.
- This is the reason a bare `@()` wrap is not sufficient protection. The standard
  PowerShell advice "always wrap pipeline output in `@()` before `.Count`" guards against
  a *scalar* collapsing to a non-array; it does nothing about a `$null`, which `@()`
  faithfully turns into a one-element array containing nothing.
- Under `Set-StrictMode -Version Latest` the symptom is an error naming a property
  (`The property 'AccessRights' cannot be found on this object`) which reads like a schema
  or permissions problem and sends you looking at RBAC. Check for the `$null` first.
- Related: `get-inboxrule-null-count.md` (the cmdlet-level form) and
  `get-messagetracev2-10-day-cap.md`.
