---
tech: windows
tags: [security, lpe, toctou, symlink, junction, rmm, cleanup, windows, macos]
severity: high
---
# Privileged cleanup must not walk user-writable trees by path

## PROBLEM
A cleanup running as SYSTEM (Windows) or root (macOS) that checks a user-owned folder for reparse points/symlinks and later lists or deletes it by path string can be redirected. Between check and delete the user swaps a directory, or any user-owned component of the path, for a junction or symlink, and the privileged delete lands in `C:\Windows\System32` or `/private/var/db`. Arbitrary file delete as SYSTEM is a known local privilege escalation primitive; on macOS deleting `/private/var/db/.AppleSetupDone` reruns Setup Assistant, which creates a new admin. Affected paths include `%TEMP%`, `$Recycle.Bin\<SID>`, subfolders of `C:\Windows\Temp`, the WER ReportQueue, `~/Library/Caches`, `~/Library/Logs`, `~/.Trash` and Xcode DerivedData. BSD `find -delete` (fts with FTS_PHYSICAL and fchdir) is race-safe inside a tree, but its start path is still resolved by string as the privileged user.

## WRONG
```powershell
# check at push time, act at pop time -- the gap is the race
if (-not ($d.Attributes -band [IO.FileAttributes]::ReparsePoint)) { $stack.Push($d.FullName) }
# ...later
Get-ChildItem -LiteralPath $stack.Pop() | Remove-Item -Force
```
```bash
# as root
[ -L "$HOME/.Trash/x" ] || find "$HOME/.Trash/x" -delete
```

## RIGHT
```bash
# Run per-user scopes as the owning user, so a redirect can reach only what that user could delete anyway
sudo -n -u "#$uid" -- /usr/bin/find "$home/Library/Caches" -xdev -mindepth 1 -delete
```
```powershell
# As SYSTEM, touch only admin-only paths, and only top-level files of C:\Windows\Temp (no recursion).
# Deleting a file link removes the link, not its target.
Get-ChildItem -LiteralPath 'C:\Windows\Temp' -File -Force | Remove-Item -Force
Remove-Item 'C:\Windows\SoftwareDistribution\Download\*' -Recurse -Force
```

## NOTES
A reparse check is a snapshot, not a guarantee. See also [Go ModeSymlink does not identify every Windows reparse point](go-mode-symlink-misses-windows-reparse-points.md). On Windows, per-user scopes need impersonation or a task running as the user.
