---
tech: chrome
tags: [chrome, service-worker, owa, outlook-web, m365, browser-update, relaunch, group-policy, misdiagnosis]
severity: high
---
# Pending Chrome update stalls service-worker apps (OWA) while other sites load fine

## PROBLEM

Chrome auto-updates by replacing its on-disk binaries while the current process keeps running. Until the browser is relaunched, that running instance cannot reliably spawn renderers and service workers, because the files they reference were swapped out underneath it.

The failure is selective, and that is what makes it deceptive. Apps built on service workers stall; ordinary pages served from already-established processes keep working. The user reports "Outlook is broken but the internet is fine", which reads like a network, DNS, mailbox, or M365 problem and sends you looking in entirely the wrong place.

Outlook Web is almost purely service-worker driven, so it is the app that breaks first. It hangs rendering grey skeleton placeholders in the reading pane rather than erroring, so there is no error message, no event-log entry, and no failed request to find.

Real case: user reported OWA slow or not loading, on and off, for weeks. Chrome started 09:31. Update written to disk 14:13. User hit the stall 14:29 and switched to Edge at 14:33, where the same mailbox loaded instantly. Every health metric was green (19 GB RAM free, 388 GB disk free, CPU 18%, no recent errors). A full day went into ruling out disk (chkdsk clean), WAN failover (none in 17 days), DNS, and even purging 135 stale AD zone-root A records, a real but completely unrelated defect, before a screenshot showed Chrome and Edge side by side.

## WRONG

```powershell
# Treating "one web app is slow, everything else is fine" as an infrastructure fault
# and burning hours down the stack. None of this finds it:

chkdsk C: /scan                                   # filesystem: clean
Test-NetConnection outlook.office.com -Port 443   # connectivity: fine
Resolve-DnsName outlook.office.com                # DNS: fine
Get-DnsServerResourceRecord -ZoneName corp.local  # AD/DNS rabbit hole
# ...check the firewall, the WAN uplinks, the mailbox size, M365 service health...

# Every metric is healthy, so you keep escalating into infrastructure,
# and any real-but-unrelated defect you stumble across will feel like the answer.
```

## RIGHT

```powershell
# Check for a staged-but-not-relaunched Chrome update FIRST. Takes seconds.

# Two version folders = update staged, relaunch pending
Get-ChildItem 'C:\Program Files\Google\Chrome\Application' -Directory |
    Where-Object Name -match '^\d'

# This file existing at all means a relaunch is required
Test-Path 'C:\Program Files\Google\Chrome\Application\new_chrome.exe'

# The running binary vs what the updater thinks is installed
(Get-Item 'C:\Program Files\Google\Chrome\Application\chrome.exe').VersionInfo.ProductVersion
(Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Google\Update\Clients\{8A69D345-D564-463c-AFF1-A69D9E530F96}').pv

# FIX: fully close Chrome, all processes, not just the window.
# The update finalizes on close: new_chrome.exe disappears and the stale
# version folder is removed. That self-cleanup retroactively confirms the diagnosis.

# PREVENTION: stop it degrading silently again.
$k = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
New-Item -Path $k -Force | Out-Null
New-ItemProperty -Path $k -Name 'RelaunchNotification'       -Value 2        -PropertyType DWord -Force
New-ItemProperty -Path $k -Name 'RelaunchNotificationPeriod' -Value 86400000 -PropertyType DWord -Force
# 2 = Required: show an escalating prompt, then force the relaunch after the deadline.
# Chrome performs session restore on a policy-forced relaunch, so no tabs are lost.
```

## NOTES

**Cheapest triage of all: try the same URL in a different browser.** If it works in Edge and not Chrome, stop looking at the network. That one test costs 30 seconds and collapses the entire search space. Do it before touching any infrastructure.

**Never scope a forced-relaunch policy to POS or kiosk machines.** A register relaunching Chrome mid-service is worse than the problem being solved. Exclude by name match on POS, KITCH, BAR, GOLF, DINING, FRONTDESK, STARTER, PATIO and similar, and verify the exclusion actually held. OU names frequently lie: in the case above, an OU literally named "Office Workstations" contained live POS terminals, so OU-based targeting could not express "staff, not POS" and a security group was required.

**Two Group Policy gotchas if you deploy the policy by GPO:**

- Computer group membership does not apply until the machine's Kerberos ticket refreshes, which means a **reboot**. `gpupdate` alone is not enough and will make you think the GPO is broken. To test immediately: `klist -li 0x3e7 purge` then `gpupdate /target:computer /force`.
- When security-filtering a GPO to a group, leave **Authenticated Users with Read** (just remove Apply). Stripping it entirely triggers the MS16-072 behavior where the GPO silently stops applying to everyone.

**Generalizes beyond OWA and beyond Chrome.** Any long-lived Chromium browser left running across an auto-update can exhibit this, and any heavily service-worker-dependent web app (Teams, Gmail, Zoom web) is a candidate to break first. Users who never close their browser for days are the ones who hit it repeatedly, which is exactly what makes it look like a recurring "network problem" rather than a one-off.

**Meta-lesson on sequencing.** Finding a large, genuinely broken piece of infrastructure while investigating an unrelated user complaint is seductive, and its severity makes it feel like the answer. Fix it on its own merits, but do not close the user's ticket on it. Confirm the reported symptom actually stops first.
