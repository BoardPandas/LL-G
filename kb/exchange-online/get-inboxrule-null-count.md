---
tech: exchange-online
tags: [get-inboxrule, get-messagetracev2, get-exomailbox, null, array-safety, count, mailbox-audit, incident-response, bec, silent-wrong-output]
severity: high
---
# EXO cmdlets return $null for zero results, so @(...).Count is 1 whether there are zero matches or one

## PROBLEM
Multiple Exchange Online cmdlets do not emit an empty collection when nothing matches.
They return a literal `$null`. Wrapping that in the standard defensive idiom `@(...)`
produces a **one-element array containing `$null`**, because `@($null).Count` is 1.

So the usual "safe" count reports **1 result when there are zero**, with no error, no
warning, and a `Count` that looks entirely plausible.

The sharper problem is that `@(...).Count -eq 1` is **ambiguous**. Measured against a
live tenant (ExchangeOnlineManagement 3.9.2, app-only cert auth):

| Query | `$null -eq $raw` | `@($raw).Count` | actual results |
|---|---|---|---|
| `Get-MessageTraceV2` zero matches | `True`  | **1** | 0 |
| `Get-MessageTraceV2` one match    | `False` | **1** | 1 |
| `Get-InboxRule` rule-free mailbox | `True`  | **1** | 0 |
| `Get-EXOMailbox` no match (`-ErrorAction SilentlyContinue`) | `True` | **1** | 0 |

A `Count` of 1 therefore proves nothing. You cannot tell "no mail from this sender"
apart from "exactly one mail from this sender" without inspecting for `$null` first,
and one message is the interesting case in phishing triage.

This is dangerous specifically in compromised-account and BEC work, where the count
*is* the finding:

- Read one way, you chase a phantom result that does not exist. Enumerating its
  properties then throws `The property 'Name' cannot be found on this object`
  under `Set-StrictMode`, which looks like a permissions or API problem rather
  than an empty result.
- Read the other way (`if ($rules.Count -eq 1) { "just the default, fine" }`, or a
  loop body that silently no-ops on the `$null` element), a **real malicious rule or
  a real phishing message is reported as CLEAN**.
- In a message trace specifically, a per-sender loop prints an identical
  "1 message(s)" header for a sender that mailed you once and a sender that never
  mailed you at all. The two are indistinguishable in the output.

Do not assume `@()` normalizes emptiness; it only normalizes *scalars*.

## WRONG
```powershell
# Reports "1 rule(s) found" on a mailbox with ZERO rules.
$rules = @(Get-InboxRule -Mailbox $mb -ErrorAction Stop)
Write-Host "$($rules.Count) rule(s) found"

foreach ($r in $rules) {
    # $r is $null. Under Set-StrictMode -Version Latest this throws
    # "The property 'Name' cannot be found on this object",
    # which reads like an auth/API failure, not "there are no rules".
    Write-Host $r.Name
}

# Equally broken emptiness check: never true, because Count is 1.
if ($rules.Count -eq 0) { Write-Host "No rules. Mailbox clean." }
```

```powershell
# Same trap in phishing triage. Every sender reports "1 message(s)",
# including the two that never sent anything.
foreach ($s in @('real-phisher@bad.example','never-sent@bad.example')) {
    $hits = @(Get-MessageTraceV2 -SenderAddress $s -StartDate $start -EndDate $end)
    Write-Host "$s : $($hits.Count) message(s)"    # both print 1
}
```

## RIGHT
```powershell
# Filter the nulls out before counting.
$rules = @(Get-InboxRule -Mailbox $mb -ErrorAction Stop |
           Where-Object { $null -ne $_ })

if ($rules.Count -eq 0) {
    Write-Host "No inbox rules (verified)."
} else {
    Write-Host "$($rules.Count) rule(s) found"
    foreach ($r in $rules) {
        Write-Host "$($r.Name) fwd=$($r.ForwardTo) redirect=$($r.RedirectTo) delete=$($r.DeleteMessage)"
    }
}
```

```powershell
# Message trace: filter on a real property, not just truthiness, so a
# malformed row cannot be counted as a hit either.
$hits = @(Get-MessageTraceV2 -SenderAddress $s -StartDate $start -EndDate $end |
          Where-Object { $_ -and $_.SenderAddress })

Write-Host "$s : $($hits.Count) message(s)"
if ($hits.Count -gt 0) {
    $hits | Select-Object Received, SenderAddress, RecipientAddress, Subject, Status |
        Sort-Object Received | Format-Table -AutoSize
}
```

```powershell
# Or test the raw result explicitly before wrapping, which also lets you
# distinguish "no results" from "the call failed".
$raw = Get-InboxRule -Mailbox $mb -ErrorAction Stop
if ($null -eq $raw) {
    Write-Host "No inbox rules (verified)."
} else {
    foreach ($r in @($raw)) { <# ... #> }
}
```

## NOTES
Confirm emptiness rather than inferring it. `$null -eq $raw` returning `$true` is
positive proof of zero results; a `Count` of 1 proves nothing either way.

Direct complement to `kb/powershell/array-safety.md`. That entry correctly says to
wrap in `@()` so a single result does not collapse to a scalar. This is the other
half: `@()` fixes the scalar case but **creates** a false count in the null case.
Apply both, and reach for `| Where-Object { $null -ne $_ }` when you need a count
you can act on.

Pairs with `kb/powershell/locked-file-read-false-clean.md`: in a security audit,
any check that cannot distinguish "found nothing" from "failed to look" must fail
loud rather than report CLEAN. Track per-check success separately and refuse to
summarize a mailbox as clean if any check errored.

Also note `kb/exchange-online/app-only-401-propagation.md`: under app-only auth
`Get-InboxRule` may 401 outright, which is a *different* failure from returning
`$null`. Distinguish them, or a permissions gap gets recorded as "no rules found".

**Related trap when writing the message-trace version:** `Get-MessageTrace` (V1) began
deprecating 2025-09-01 and in 3.9.2 now **throws** rather than warns, pointing you at
`Get-MessageTraceV2`. Feature-detecting with `if (Get-Command Get-MessageTrace)`
therefore still succeeds -- the cmdlet is present -- and the call dies at runtime. Detect
by preferring `Get-MessageTraceV2` when it exists, not by probing for V1's presence. V2
also paginates differently: it returns a WARNING telling you to re-run with
`-EndDate <last Received>` and `-StartingRecipientAddress <last RecipientAddress>`, so a
V1-style `-Page`/`-PageSize` loop silently scans nothing at all.

Discovered 2026-07-30 auditing an AiTM-compromised M365 mailbox (app-only EXO
PowerShell, ExchangeOnlineManagement 3.9.2). The first pass reported "1 rule" on
two mailboxes that both actually had none. Extended 2026-08-03 after the identical
trap surfaced in a BEC message trace, where two never-seen lookalike-domain senders
and one genuine phishing sender all reported "1 message(s)"; the zero-vs-one
ambiguity and the `Get-EXOMailbox` case were confirmed against a live tenant.
