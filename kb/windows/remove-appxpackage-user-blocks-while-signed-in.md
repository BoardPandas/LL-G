---
tech: windows
tags: [windows, appx, msix, Remove-AppxPackage, pending removal, signed-in user, sign-out, powershell]
severity: medium
---
# Remove-AppxPackage -User on a signed-in user blocks and leaves "pending removal"

## PROBLEM
`Remove-AppxPackage -User <sid>` for a user who is currently signed in does not complete. The call blocks, and the package is left in a "pending removal" state. It is still listed and still launchable for that user until they sign out. A script that checks removal immediately either hangs or reads the package as still installed and reports a false failure.

Check for an active session before removing a package for a specific user, and treat "pending removal" as in progress rather than done.

## WRONG
```powershell
Remove-AppxPackage -Package $fullName -User $userSid
Get-AppxPackage -User $userSid -Name $name   # still listed; the removal is not finished
```

## RIGHT
```powershell
$signedIn = (query user 2>$null) -match $userName
if ($signedIn) {
    # Defer: the removal completes at sign-out. Report "pending", do not wait here.
    return 'pending-signout'
}
Remove-AppxPackage -Package $fullName -User $userSid
```
Verify removal by the package's user-state entry for that SID rather than by a bare `Get-AppxPackage`, and re-check after the user signs out.

## NOTES
- Removing the provisioned package stops new users from receiving it, but it does not remove the copy already installed for an existing user.
- The "pending" state is not visible from the package's install state alone. Log the deferral so the next run knows the removal is still owed.
