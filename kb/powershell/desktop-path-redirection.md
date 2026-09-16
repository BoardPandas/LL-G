---
tech: powershell
tags: [desktop, onedrive, known-folder-move, shortcuts, user-profile, silent-failure]
severity: high
---
# Hardcoded Desktop paths silently miss OneDrive-redirected Desktops

## PROBLEM
`C:\Users\<user>\Desktop` is not reliably the user's real Desktop. OneDrive Known
Folder Move redirects it to `C:\Users\<user>\OneDrive - <Tenant>\Desktop`, and the
profile folder itself can carry a domain suffix (`jpinheiro.PEAKTECHNICAL`) when a
profile was created against a domain that also exists locally.

The failure is silent rather than loud. Writing to the non-redirected path still
succeeds -- the stale `C:\Users\<user>\Desktop` usually still exists after KFM, and
if it does not, `CreateShortcut().Save()` and `Set-Content` create it. So the script
exits 0, the deployment channel (Intune, an RMM, a logon script) records success, and
the user never sees the file. Nothing anywhere reports an error, so the deployment
looks healthy while doing nothing.

Fleet composition makes this worse than it looks: KFM is per-user, so the same script
hits redirected and non-redirected profiles in one run, and testing on a single
machine proves nothing about the rest.

## WRONG
```powershell
# Assumes the Desktop lives under the profile root
$desktop = "C:\Users\$env:USERNAME\Desktop"
$lnk = Join-Path $desktop 'Autodesk Forma.lnk'

$sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sc.TargetPath = $edge
$sc.Save()          # exits 0 having written somewhere the user never looks
```

## RIGHT
```powershell
# Resolves whatever the shell is actually configured to use, redirected or not
$desktop = [Environment]::GetFolderPath('Desktop')
if (-not (Test-Path $desktop)) {
    Write-Error "Desktop path not found: $desktop"
    exit 1
}

$lnk = Join-Path $desktop 'Autodesk Forma.lnk'
$sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sc.TargetPath = $edge
$sc.Save()

# Echo the resolved path so the deployment report proves WHERE it wrote
Write-Host "Created '$lnk'"
```

## NOTES
`[Environment]::GetFolderPath('Desktop')` reads the shell folder configuration for the
running user, so it follows KFM, Group Policy folder redirection, and manually moved
Desktops alike. It only works if the script runs **in the user's context** -- a script
running as SYSTEM resolves SYSTEM's Desktop, not the signed-in user's. For Intune
platform scripts that means `runAsAccount: user`; for per-machine shortcuts, write to
the Public Desktop (`$env:PUBLIC\Desktop`) deliberately instead.

Have the script print the resolved path and surface that in the run output. Verified
on a 7-machine fleet (2026-09-16) where one script legitimately resolved three
different real Desktops:

```
C:\Users\JimmyLavoie\Desktop                                        (no KFM)
C:\Users\rcoggon\OneDrive - Peak Technical Solutions\Desktop        (KFM)
C:\Users\jpinheiro.PEAKTECHNICAL\OneDrive - ...\Desktop             (KFM + domain suffix)
```

Without the echoed path, a "success" result is indistinguishable from a shortcut
written into a folder nobody opens.

The same reasoning applies to Documents, Pictures and Favorites -- use the matching
`GetFolderPath` enum rather than composing the path from the profile root.
