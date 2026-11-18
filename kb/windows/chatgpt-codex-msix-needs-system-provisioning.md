---
tech: windows
tags: [windows, winget, msix, appx, Add-AppxProvisionedPackage, provisioning, system account, codex, chatgpt]
severity: medium
---
# A ~1 GB MSIX package fails a user-context winget install

## PROBLEM
Large MSIX packages such as the ChatGPT / Codex desktop app (about 1 GB) do not install from a user-context `winget install`. It fails with `0x80073d28`. Provisioning the same package machine-wide as SYSTEM with `Add-AppxProvisionedPackage` succeeds. The error code does not say the install needs machine-level provisioning, so the failure reads as a broken package or a bad source.

## WRONG
```powershell
# Runs as the signed-in user; fails with 0x80073d28
winget install <package-id> --silent
```

## RIGHT
```powershell
# Runs as SYSTEM (for example an elevated agent or scheduled task)
Add-AppxProvisionedPackage -Online -PackagePath $msixPath -SkipLicense
```
Use `-LicensePath` instead of `-SkipLicense` when the package ships a license file.

## NOTES
- Provisioning installs the package for future users. Check the result with `Get-AppxProvisionedPackage -Online`, not with the signed-in user's `Get-AppxPackage`.
- The follow-on entries in this shelf cover cleanup of the package file after provisioning and removal of an installed package while its user is signed in.
