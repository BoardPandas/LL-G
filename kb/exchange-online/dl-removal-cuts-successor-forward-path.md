---
tech: exchange-online
tags: [offboarding, distribution-groups, mail-forwarding, continuity, silent-data-loss]
severity: high
---
# Removing a leaver from a DL can cut the successor off, because the forward was the only path

## PROBLEM
Standard offboarding says "remove the leaver from all distribution groups". Do that blindly and you can silently stop mail reaching the person who took over their job.

The setup is common. Before someone leaves you configure `ForwardingAddress` on their mailbox so their mail reaches a successor. That forward also carries **everything the leaver received via distribution lists**. If the successor is not independently a member of those lists, the leaver's mailbox is the *only* route by which they see that traffic.

Remove the leaver from the DL and delivery to the successor stops. There is no error, no bounce, no warning. The DL still exists, still has members, still delivers. The successor just quietly stops receiving a category of mail nobody notices until something is missed -- and by then the change is weeks old and nobody connects it to the offboarding.

Observed live: a two-member finance-board list where the departing user was one member and the successor was not on it at all. Removing her would have ended his access to board mail entirely, while the audit script cheerfully reported "removed from 3/3 groups".

## WRONG
```powershell
# Blanket removal -- the standard offboarding step, and the one that breaks continuity
$lists = Get-DistributionGroup -ResultSize Unlimited
foreach ($dl in $lists) {
    Remove-DistributionGroupMember -Identity $dl.Identity -Member $userUPN -Confirm:$false
}
# Successor silently stops receiving anything they only got via the leaver's forward.
```

## RIGHT
```powershell
# For every DL the leaver belongs to, check whether the successor is already on it.
# If not, ADD them, CONFIRM, and only then remove the leaver.
foreach ($dl in $leaverLists) {
    $addrs = @(Get-DistributionGroupMember -Identity $dl -ResultSize Unlimited |
               ForEach-Object { [string]$_.PrimarySmtpAddress })

    if ($addrs -notcontains $successor) {
        Write-Warning "$dl : $successor is NOT a member. The leaver's forward is their only path."
        Add-DistributionGroupMember -Identity $dl -Member $successor -ErrorAction Stop
        Start-Sleep -Seconds 8
        $addrs = @(Get-DistributionGroupMember -Identity $dl -ResultSize Unlimited |
                   ForEach-Object { [string]$_.PrimarySmtpAddress })
        if ($addrs -notcontains $successor) { Write-Warning "$dl : add unconfirmed, NOT removing leaver"; continue }
    }

    Remove-DistributionGroupMember -Identity $dl -Member $userUPN -Confirm:$false
}
```

## NOTES
- The inverse is also worth catching: if the successor **is** already a member, the forward is now delivering them a duplicate of every DL message. Removing the leaver fixes that, so the check pays off in both directions.
- Order is the whole lesson: **add successor -> confirm -> remove leaver**. Never remove first.
- `/memberOf` in Graph does not return Exchange distribution lists at all, so a Graph-only offboarding never even sees these groups. Enumerate via `Get-DistributionGroup` / `Get-DistributionGroupMember`.
- Do not gate the removal on an EXO membership pre-read -- those are replica-inconsistent (see exo-membership-reads-replica-inconsistent.md). Gate the *additive* step; attempt the removal and treat "not a member" as benign.
- Same reasoning applies to shared-mailbox delegation and OneDrive access: match the delegate to whoever is receiving the forward.
