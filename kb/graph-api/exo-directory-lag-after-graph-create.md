---
tech: graph-api
tags: [exchange-online, propagation, timing, user-creation, add-distributiongroupmember, mailbox-provisioning]
severity: high
---
# Exchange Online directory has propagation lag after Graph user creation

## PROBLEM
Right after `POST /users` succeeds via Microsoft Graph, the Exchange Online directory has not yet picked up the new user. EXO cmdlets that resolve recipients (`Add-DistributionGroupMember`, `Set-Mailbox`, `Add-MailboxFolderPermission`, `Set-MailboxAutoReplyConfiguration`, etc.) fail with a misleading "Couldn't find object" error, even though the user exists in Entra ID and you can read it via Graph in the same session. Same root cause as Graph permission propagation, just on the EXO recipient side, with a different fix.

The lag is typically 30 to 120 seconds. The lazy signal that EXO has caught up is mailbox provisioning -- once `Get-Mailbox` returns the new user, EXO has them in its directory and DL/calendar/forwarding cmdlets work.

Adding sleeps or retry loops works but masks the underlying ordering issue. Use the mailbox provisioning step as the natural sync gate instead.

## WRONG
```powershell
# Create the user
$created = Invoke-MgGraphRequest -Method POST -Uri '/v1.0/users' -Body $body ...
$upn = $created.userPrincipalName

# Assign license
Invoke-MgGraphRequest -Method POST -Uri "/v1.0/users/$($created.id)/assignLicense" ...

# Immediately try to add to a distribution list -- FAILS
Add-DistributionGroupMember -Identity $allSuite -Member $upn
# Couldn't find object "user@tenant.com". Please make sure that it was spelled correctly...

# Or any other EXO recipient op against the same user -- also fails the same way
Set-MailboxAutoReplyConfiguration -Identity $upn ...
Add-MailboxFolderPermission -Identity "calendar:\Calendar" -User $upn ...
```

## RIGHT
```powershell
# 1) All Graph work first: create user, set manager, license, M365/security group adds.
#    Graph-side operations do not need to wait.
$created = Invoke-MgGraphRequest -Method POST -Uri '/v1.0/users' -Body $body ...
Invoke-MgGraphRequest -Method POST -Uri "/v1.0/users/$($created.id)/assignLicense" ...
Invoke-MgGraphRequest -Method POST -Uri "/v1.0/groups/$gid/members/`$ref" ...

# 2) Poll for mailbox provisioning. This is the natural EXO sync gate.
$deadline = (Get-Date).AddMinutes(10)
$ready = $false
while (-not $ready -and (Get-Date) -lt $deadline) {
    try {
        $mbx = Get-Mailbox -Identity $created.userPrincipalName -ErrorAction Stop
        if ($mbx) { $ready = $true }
    } catch {
        Start-Sleep -Seconds 30
    }
}
if (-not $ready) { throw "Mailbox did not provision within 10 minutes" }

# 3) Now do all EXO recipient ops. EXO directory has the user.
Add-DistributionGroupMember -Identity $allSuite -Member $created.userPrincipalName
Add-MailboxFolderPermission -Identity "$cal:\Calendar" -User $created.userPrincipalName -AccessRights Reviewer
```

## NOTES
- The "Couldn't find object" error is the same whether the user truly does not exist or whether EXO just has not synchronized yet. There is no way to distinguish them from the error message alone.
- `Get-Mailbox` returning the user means license provisioning finished AND EXO has the directory entry. Both are required for DL / calendar / forwarding ops.
- Order matters more than retries. Putting `Get-Mailbox` polling before any EXO recipient cmdlet removes the race entirely. Retry loops on `Add-DistributionGroupMember` work but burn time on backoffs that aren't needed if you order correctly.
- If you must do an EXO op before the mailbox is ready (rare -- e.g. setting a mail contact before licensing), retry with backoff: 5s, 15s, 30s, 60s.
- Distinct from the Graph permission propagation gotcha (`permission-propagation.md`). That one is about token scopes after admin consent. This one is about EXO recipient directory after user creation. Both can hit in the same script.
- Encountered during multi-step intern onboarding at Woodberry Associates (2026-05-19): create + license + groups + mailbox + calendar perms in a single pipeline. The DL add was the first EXO recipient op and failed against a 30s-old Graph-created user. Reordering so mailbox poll preceded all EXO ops fixed it permanently.
