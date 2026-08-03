---
tech: exchange-online
tags: [get-messagetracev2, message-trace, dormancy-audit, error-suppression, try-catch, false-negative, exo]
severity: high
---
# Get-MessageTraceV2 rejects any window longer than 10 days, and a try/catch turns that into "this mailbox is dormant"

## PROBLEM

`Get-MessageTraceV2` refuses any single query whose `StartDate`/`EndDate` span exceeds
**10 days**:

```
||The interval between StartDate and EndDate can't be longer than 10 days.
```

Unguarded, that is an obvious failure. The problem is that nobody calls message trace
unguarded. Trace availability varies by tenant, licence and RBAC, so the natural defensive
shape is a `try/catch` (or `-ErrorAction SilentlyContinue`) that yields an empty
collection on failure. That converts "your query was structurally invalid and never ran"
into **"this address received no mail."**

The reason you would ask for a window longer than 10 days in the first place is almost
always a **dormancy or usage audit** -- is this mailbox still used, can we delete it, is
this shared mailbox worth a licence. So the false answer is precisely the answer you were
hoping to confirm, and it arrives with no error, no warning and a plausible-looking zero.
The next step after "0 messages in 60 days" is usually deleting a mailbox.

Verified on a live tenant 2026-08-03: a 60-day query returned `0` for a mailbox and `0`
for the tenant's busiest accounting address alike. Re-run as six 10-day chunks, the same
addresses returned `0` and `95`.

## WRONG

```powershell
# 60-day dormancy check. Reports EVERY address as dormant, including the busiest
# mailbox in the tenant, because the query is rejected before it ever runs.
try {
    $msgs = @(Get-MessageTraceV2 -RecipientAddress $addr `
        -StartDate ([DateTime]::UtcNow.AddDays(-60)) `
        -EndDate   ([DateTime]::UtcNow) -ResultSize 1000)
} catch {
    $msgs = @()
}

if ($msgs.Count -eq 0) {
    Write-Output "$addr : dormant, no mail in 60 days -- safe to delete"
}
```

## RIGHT

```powershell
# Walk the window in <=10 day chunks. Let a genuine failure surface instead of
# collapsing it into an empty result.
$now   = [DateTime]::UtcNow
$all   = @()
$chunks = 6                      # 6 x 10 days = 60

for ($i = 0; $i -lt $chunks; $i++) {
    $end   = $now.AddDays(-10 * $i)
    $start = $now.AddDays(-10 * ($i + 1))

    # Get-MessageTraceV2 also emits a literal $null on zero results, so filter it
    # out before counting -- see get-inboxrule-null-count.md.
    $all += @(Get-MessageTraceV2 -RecipientAddress $addr `
        -StartDate $start -EndDate $end -ResultSize 1000 -ErrorAction Stop |
        Where-Object { $null -ne $_ })
}

Write-Output "$addr : $($all.Count) message(s) over $($chunks * 10) days"
```

Prove the method before trusting a zero. Run the identical code path against an address
you know is busy; if the control also returns `0`, the harness is broken, not the mailbox:

```powershell
# control -- this MUST come back non-zero, or your counting logic is wrong
$control = @(Get-MessageTraceV2 -RecipientAddress $knownBusyAddress `
    -StartDate $now.AddDays(-10) -EndDate $now -ResultSize 1000 |
    Where-Object { $null -ne $_ })
if ($control.Count -eq 0) { throw "Trace harness returns 0 for a known-busy address. Do not trust any result." }
```

## NOTES

- `-ErrorAction Stop` inside the loop is deliberate. If you must catch, catch *narrowly*
  and re-throw anything that is not a known-benign condition; never let an invalid-query
  error and a genuinely empty mailbox produce the same value.
- The 10-day cap is a property of the **query span**, not of `-ResultSize`. Raising
  `-ResultSize` does nothing.
- Message trace retention is finite (about 90 days on most plans), so a "no results" past
  that horizon is expected rather than evidence of dormancy. Do not read absence beyond
  retention as absence of activity.
- Trace alone is weak evidence for a dormancy claim. Corroborate with
  `Get-MailboxFolderStatistics -IncludeOldestAndNewestItems` (`NewestItemReceivedDate` is
  the strongest single signal), `Get-MailboxStatistics` (`LastLogonTime`,
  `LastInteractionTime`), and whether anything forwards into the address or it is a
  member of any distribution list.
- Related: `get-inboxrule-null-count.md` (the `$null`-on-zero-results sentinel that
  affects this same cmdlet) and
  `unset-property-null-inverts-safety-gate.md` (the same `$null` shape one level down,
  on properties of returned objects).
