---
tech: exchange-online
tags: [replication, consistency, verification, distribution-groups, permissions, graph]
severity: high
---
# EXO membership and permission reads are replica-inconsistent, and disagree with Graph

## PROBLEM
`Get-DistributionGroupMember`, `Get-MailboxPermission` and `Get-RecipientPermission` are served from replicas that lag independently. Two identical reads seconds apart can return different answers, and EXO can flatly contradict Graph about the same object.

Observed in one session:

- `Get-DistributionGroupMember AllStaff` returned **5 members** while `GET /groups/{id}/members` returned **7** for the same group at the same moment -- the two missing users were present and unmodified.
- `Remove-RecipientPermission ... -AccessRights SendAs` returned success, and an immediate re-read still listed the trustee. Re-running the removal reported success again. It cleared on its own minutes later.
- Two identical SendAs removals issued in the same session against the same mailbox read back differently: one gone, one still present.

This burns you two ways. First, you re-issue a change that already worked, because verification says it did not -- harmless for idempotent removes, but it hides real failures in the noise. Second, and much worse, you **gate a destructive action on a stale read**: script logic like `if ($members -contains $user) { remove }` either skips a removal that was needed, or a "safe to remove, someone else still has access" check passes against membership that is not actually there.

## WRONG
```powershell
# Gating a destructive action on an EXO pre-read
$members = @(Get-DistributionGroupMember -Identity $dl | ForEach-Object { $_.PrimarySmtpAddress })
if ($members -contains $successor) {
    Remove-DistributionGroupMember -Identity $dl -Member $leaver -Confirm:$false
}
# The pre-read may be stale in EITHER direction:
#  - successor missing from a stale list -> removal skipped, cleanup silently incomplete
#  - successor listed but not actually there -> you remove the leaver and break delivery

# Equally wrong: treating a failed read-back as a failed write
Remove-RecipientPermission -Identity $mbx -Trustee $u -AccessRights SendAs -Confirm:$false
if (Get-RecipientPermission -Identity $mbx | Where-Object Trustee -eq $u) {
    Remove-RecipientPermission -Identity $mbx -Trustee $u -AccessRights SendAs -Confirm:$false  # churn
}
```

## RIGHT
```powershell
# 1. Gate ADDITIVE steps (safe to over-confirm), never destructive ones.
Add-DistributionGroupMember -Identity $dl -Member $successor -ErrorAction Stop
Start-Sleep -Seconds 8
$present = @(Get-DistributionGroupMember -Identity $dl |
             ForEach-Object { [string]$_.PrimarySmtpAddress }) -contains $successor
if (-not $present) { Write-Warning "unconfirmed; NOT proceeding to removal"; return }

# 2. Attempt the removal unconditionally; treat "not a member" as benign.
try {
    Remove-DistributionGroupMember -Identity $dl -Member $leaver -Confirm:$false -ErrorAction Stop
} catch {
    if ($_.Exception.Message -match "isn't a member|not a member|couldn't be found") {
        Write-Output "already absent"
    } else { throw }
}

# 3. Verify against GRAPH, or re-verify on a delay -- not with an immediate EXO re-read.
$graph = @((Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/v1.0/groups/$groupId/members" -OutputType PSObject).value)
```

## NOTES
- Rule of thumb: **hard-gate additive operations, never destructive ones.** An extra add is recoverable; a wrongly-skipped or wrongly-performed removal is not obvious for weeks.
- Graph proved authoritative in every disagreement observed here. When they conflict, verify with Graph.
- Propagation for SendAs / `RecipientPermission` can take up to an hour. Budget for it in verification rather than re-issuing.
- Do not "fix" a stale read by repeating the write. Repeat the *read*, later.
- Related: read-after-write-lag.md (the Graph-side equivalent), exo-directory-lag-after-graph-create.md (lag in the other direction, Graph -> EXO), dl-removal-cuts-successor-forward-path.md.
