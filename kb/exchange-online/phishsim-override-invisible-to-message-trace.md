---
tech: exchange-online
tags: [phishing, message-trace, defender, advanced-delivery, phish-sim, incident-response, app-only]
severity: high
---
# A phishing simulation is invisible to Get-MessageTraceV2, so trace rows cannot tell you whether a reported phish arrived or whether it was sanctioned

## PROBLEM
Two failures compound into the wrong answer on exactly the ticket you most want to get right: a user reports a phish, and you decide whether to reset their password.

**1. Mail allowlisted by the Defender advanced delivery phishing-simulation policy does not appear in message trace at all.** Not as a row with a different verdict, not as "FilteredAsSpam" -- there is no row. Verified on a managed tenant: the message provably arrived at 17:51 UTC (the user forwarded it with full headers and body), and a 19-hour `Get-MessageTraceV2` of that recipient returned five unrelated messages and nothing else. Absence from the trace is therefore not evidence that mail never arrived, and any campaign scope count, "who else got it" sweep, or purge target list built from trace rows will under-count a simulation campaign or miss it entirely.

**2. Nothing in the message body distinguishes a sanctioned simulation from a real attack**, because faking a real attack is precisely what a simulation is built to do. Brand-lifted imagery, a lookalike sender domain, a plausible pretext, an unmonitored-mailbox line to remove the verification path: all present in the training vendor's lure. An AI ticket summary that reasons only from the body will call it confirmed phishing at high confidence and prescribe a password reset, session revoke, inbox-rule sweep, endpoint scan, tenant-wide purge and sender-domain blocks. On the case this entry comes from, all six were wrong, and the domain blocks would have disabled every future simulation at that client.

The authoritative read is the tenant's own phish-sim override rule, and it is one read-only call.

## WRONG
```powershell
# Decide from the body plus a message trace, then remediate.
$trace = Get-MessageTraceV2 -SenderAddress $reportedSender `
                            -StartDate (Get-Date).AddDays(-1) -EndDate (Get-Date)

if (-not $trace) {
    # "No trace rows" read as "it never landed / already filtered".
    # Actually also what a sanctioned simulation looks like.
}

# Scope the campaign from trace rows -- a simulation contributes zero.
$recipients = @($trace | Select-Object -Expand RecipientAddress -Unique)

# Remediate on the AI summary's verdict.
Update-MgUser -UserId $reporter -PasswordProfile @{ ... }
Revoke-MgUserSignInSession -UserId $reporter
New-TenantAllowBlockListItems -ListType Sender -Block -Entries $lureDomain  # breaks all future testing
```

## RIGHT
```powershell
# Step 0, before any remediation: is this a sanctioned test?
$rule = Get-ExoPhishSimOverrideRule

$lureDomains = @($rule.Domains) + @($rule.SenderDomainIs) | Sort-Object -Unique
$senderDomain = ($reportedSender -split '@')[-1]

if ($rule -and -not $rule.Disabled -and $lureDomains -contains $senderDomain) {
    # Security-awareness simulation. Exposure is nil: the landing page belongs to the
    # training vendor. No reset, no revoke, no rule sweep, no purge, and above all no
    # domain block -- blocking a lure domain disables future testing for the tenant.
    # Check CreatedBy / LastModifiedBy and the creation date to confirm who sanctioned it.
    return
}

# Only now treat it as real. And when you do scope it, do not trust trace alone:
# corroborate with reporter count, the mailbox itself, and the headers you were given.
$trace = Get-MessageTraceV2 -SenderAddress $reportedSender `
                            -StartDate $start -EndDate $end -ErrorAction Stop
```

## NOTES
- **`Get-PhishSimOverrideRule` (no `Exo` prefix) returns HTTP 405 "currently unavailable" through app-only Exchange access.** The `Exo`-prefixed `Get-ExoPhishSimOverrideRule` returns 200. The 405 reads like a permissions or licensing problem and sends you to RBAC; it is only the cmdlet name.
- A domain does not reach a tenant's advanced delivery phish-sim list by accident. It is there so Defender stops filtering the simulation, which means someone with tenant access put it there deliberately. `CreatedBy` / `LastModifiedBy` on the rule name them, so the rule also tells you whether your own team or the client set the program up.
- Corroborating fingerprints in the lure body, once you know to look: a hidden tracking pixel on the training platform's domain carrying the same per-recipient token as the click link, and lure imagery served from the vendor's object storage rather than the impersonated brand's CDN. Useful as confirmation, never as the primary test -- an attacker can imitate all of it, and the override rule cannot be imitated.
- Do not name the vendor or the lure domains in the reply to the reporter. Handing them a filter blunts every future test.
- The trace blind spot generalises: message trace tells you about mail the transport pipeline filtered or delivered on the normal path, so anything riding an override, a connector exception or an allowlist can be absent from it while having demonstrably arrived. Treat "no rows" as "trace has nothing to say", never as "no mail".
- Related: [Get-MessageTraceV2 rejects any window longer than 10 days](get-messagetracev2-10-day-cap.md) and [EXO cmdlets return $null for zero results](get-inboxrule-null-count.md) -- both also turn a non-answer from message trace into a false clean verdict.
