---
tech: graph-api
tags: [dirsync, exchange, gal, azure-ad-connect, on-prem, hidden]
severity: high
---
# DirSync-synced objects block cloud-side Exchange attribute changes

## PROBLEM
For users synced from on-prem AD via Azure AD Connect (DirSync), certain Exchange attributes cannot be modified from the cloud side. Attempting to set them via EXO cmdlets or Graph API fails with "the object is being synchronized from your on-premises organization." This includes `HiddenFromAddressListsEnabled` and other attributes mastered on-prem.

## WRONG
```powershell
# FAILS for DirSync-synced users
Set-Mailbox -Identity '[redacted]' -HiddenFromAddressListsEnabled $true
# Error: "The operation on mailbox ... failed because it's out of the current user's write scope.
# This action should be performed on the object in your on-premises organization."
```

## RIGHT
```powershell
# Set the attribute in on-prem AD, then force a sync
Set-ADUser -Identity 'samAccountName' -Replace @{msExchHideFromAddressLists=$true}
Start-ADSyncSyncCycle -PolicyType Delta
# Wait 2-5 minutes for propagation
```

## NOTES
- Check `onPremisesSyncEnabled` on the user object via Graph API to detect DirSync users before attempting cloud-side changes.
- Other attributes mastered on-prem that can't be changed cloud-side include: `displayName`, `mail`, `proxyAddresses`, `userPrincipalName` (if synced), and many Exchange attributes.
- Mailbox conversion (`Set-Mailbox -Type Shared`) DOES work for DirSync users -- it's an Exchange Online operation, not an AD attribute.
- License assignment/removal also works cloud-side for DirSync users since licenses are cloud-only objects.
- **If the on-prem AD lacks Exchange schema extensions** (no `msExchHideFromAddressLists` attribute): the workaround is to move the user out of the DirSync sync scope in AD, force a delta sync (user soft-deletes in Azure AD), then restore from M365 deleted users. The user is now cloud-only and all attributes can be set from the cloud side. The shared mailbox survives the soft-delete/restore cycle.
- Soft-deleted users in Azure AD are retained for 30 days. Restore via Graph: `POST /directory/deletedItems/{id}/restore`.
