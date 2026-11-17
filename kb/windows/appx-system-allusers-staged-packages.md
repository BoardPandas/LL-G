---
tech: windows
tags: [appx, msix, store-apps, get-appxpackage, system, inventory, powershell, rmm]
severity: high
---
# Get-AppxPackage as SYSTEM misses per-user Store apps, and -AllUsers adds packages nobody has installed

## PROBLEM
An RMM agent runs as SYSTEM. A bare `Get-AppxPackage` lists SYSTEM's own packages, not the per-user installs where Store/MSIX apps (ChatGPT, Teams, Outlook) actually live. A fleet search reports zero machines however many have the app, and nothing errors.

Adding `-AllUsers` fixes that but introduces two quieter problems:
- It returns every framework (VCLibs, UI.Xaml, WindowsAppRuntime, ...) and System-signed OS components, which outnumber the apps.
- It returns packages staged only for `S-1-5-18` and installed for no user: provisioned apps a user removed, and app updates downloaded but not yet applied. The latter reports a version nobody runs, which is wrong for a vulnerability sweep.

## WRONG
```powershell
# As SYSTEM: SYSTEM's packages only
Get-AppxPackage

# Every user's packages, plus frameworks, OS components and staged-only versions
Get-AppxPackage -AllUsers
```

## RIGHT
```powershell
Get-AppxPackage -AllUsers -PackageTypeFilter Main -ErrorAction SilentlyContinue |
  Where-Object {
    $_.SignatureKind -ne 'System' -and
    @($_.PackageUserInformation |
      Where-Object { "$($_.InstallState)" -notin @('Staged','NotInstalled') }).Count -gt 0
  }
```

## NOTES
- Measured on a Windows 11 endpoint as SYSTEM: bare 53, `-AllUsers` 161 (38 frameworks, 51 System-signed), filtered without the staged check 77, final 74. The 3 staged-only packages were a removed provisioned app, an unused provisioned app, and a newer Outlook version staged while the user still ran the older one.
- `-AllUsers` needs elevation; works in Windows PowerShell 5.1. The Appx module fails in PowerShell 7 without `-UseWindowsPowerShell`.
- Each version is a separate `PackageFullName`, so the same app can appear twice with different versions; only the staged filter tells you which one is in use.
- The same SYSTEM blind spot applies to `HKCU` uninstall and Run keys: they read SYSTEM's hive, not the users'.
