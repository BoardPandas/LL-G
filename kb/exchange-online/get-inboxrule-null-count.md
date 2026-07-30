---
tech: exchange-online
tags: [get-inboxrule, null, array-safety, count, mailbox-audit, incident-response, bec, silent-wrong-output]
severity: high
---
# Get-InboxRule returns $null for a rule-free mailbox, so @(...).Count is 1, not 0

## PROBLEM
`Get-InboxRule` does not emit an empty collection when a mailbox has no rules. It
returns a literal `$null`. Wrapping that in the standard defensive idiom `@(...)`
produces a **one-element array containing `$null`**, because `@($null).Count` is 1.

So the usual "safe" count reports **1 rule on a mailbox that has zero rules**, with
no error, no warning, and a `Count` that looks entirely plausible.

This is dangerous specifically in compromised-account work, where inbox rules are the
primary AiTM/BEC persistence mechanism and the rule count is the finding:

- Read one way, you chase a phantom rule that does not exist. Enumerating its
  properties then throws `The property 'Name' cannot be found on this object`
  under `Set-StrictMode`, which looks like a permissions or API problem rather
  than an empty result.
- Read the other way (`if ($rules.Count -eq 1) { "just the default, fine" }`, or a
  loop body that silently no-ops on the `$null` element), a **real malicious rule
  is reported as CLEAN**.

The same trap applies to any EXO cmdlet that returns `$null` rather than an empty
sequence. Do not assume `@()` normalizes emptiness; it only normalizes *scalars*.

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
# Or test the raw result explicitly before wrapping, which also lets you
# distinguish "no rules" from "the call failed".
$raw = Get-InboxRule -Mailbox $mb -ErrorAction Stop
if ($null -eq $raw) {
    Write-Host "No inbox rules (verified)."
} else {
    foreach ($r in @($raw)) { <# ... #> }
}
```

## NOTES
Confirm emptiness rather than inferring it. `$null -eq $raw` returning `$true` is
positive proof of zero rules; a `Count` of 1 proves nothing either way.

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

Discovered 2026-07-30 auditing an AiTM-compromised M365 mailbox (app-only EXO
PowerShell, ExchangeOnlineManagement 3.9.2). The first pass reported "1 rule" on
two mailboxes that both actually had none.
