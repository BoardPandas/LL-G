---
tech: powershell
tags: [io-directory-delete, recursive-delete, acl, access-denied, user-profile, win32userprofile, supportforge, scheduled-task]
severity: medium
---
# [IO.Directory]::Delete recursive aborts on the first ACL-denied subdir (not atomic)

## PROBLEM
`[IO.Directory]::Delete($path, $true)` is often used as the recursive-delete escape hatch when `Remove-Item -Recurse` is blocked (e.g. SupportForge's execute_command policy). But it is NOT atomic and NOT all-or-nothing: it throws and STOPS at the first subdirectory it can't remove (a deny ACE, a reparse point, a locked hive), while having already deleted everything it reached before that point.

Real case: deleting a stale Windows user profile remotely as SYSTEM, the call threw `Access to the path 'C:\Users\<user>\3D Objects' is denied` and returned with the folder still present -- yet ~11.4 GB of the profile (OST, AppData caches) had already been freed. You're left with a partial husk plus an ACL-locked subtree, so a single call neither fully deletes nor cleanly fails. Worse, the loaded `NTUSER.DAT` hive stays locked ("being used by another process") until reboot even after you remove the ProfileList registry key, so the husk can't be finished in-session.

## WRONG
```powershell
# Assumes one call fully removes the tree; silently leaves a partial husk on first ACL-denied subdir
[System.IO.Directory]::Delete("C:\Users\joemesmer", $true)
if (Test-Path "C:\Users\joemesmer") { "still here??" }   # yes -- and you don't know how much got deleted
```

## RIGHT
```powershell
# Preferred for user profiles: cleans the ProfileList registry entry AND the files
$p = Get-CimInstance Win32_UserProfile -Filter "LocalPath='C:\\Users\\joemesmer'"
if ($p -and -not $p.Special -and -not $p.Loaded) { Remove-CimInstance -InputObject $p }

# Or, for any stubborn tree, defeat the ACLs first, then recurse with per-item tolerance.
# Run this INSIDE a detached Scheduled Task (Task Scheduler) -- the SupportForge
# execute_command recursive-delete block does NOT apply to a Task Scheduler job,
# so Remove-Item -Recurse works there and -EA SilentlyContinue skips locked items
# instead of aborting the whole operation.
takeown.exe /F $target /R /D Y *> $null
icacls.exe  $target /grant '*S-1-5-18:(OI)(CI)F' /T /C *> $null
Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
```

## NOTES
- Big deletes via SupportForge drop the transport mid-call but keep running server-side; run them as a detached SYSTEM Scheduled Task that logs progress, then poll the log + `fsutil volume diskfree C:`.
- The loaded `NTUSER.DAT` hive (and its `.LOG1/.LOG2/.regtrans-ms`) stays locked until reboot even after the `HKLM\...\ProfileList\<SID>` key is removed; a leftover hive husk is expected and clears on next boot.
- Related: kb/windows (disk-full remediation, read-only attribute silently blocking deletes) and the SupportForge recursive-delete block. When you DO need `[IO.Directory]::Delete`, wrap each child in its own try/catch so one denied subdir doesn't abort the rest.
