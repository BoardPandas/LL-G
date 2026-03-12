---
tech: powershell
tags: [exchange-online, module, ps7, import, version-conflict]
severity: high
---
# Old EXO module in user path shadows system-wide version

## PROBLEM
PowerShell 7 loads modules from `~/Documents/PowerShell/Modules` before `C:\Program Files\WindowsPowerShell\Modules`. If an old ExchangeOnlineManagement (e.g., 2.0.5) exists in the user path, it shadows the system-wide v3.x. EXO 2.x is RPS-only and fails on PS7 with WinRM errors, even though the system has 3.x installed. The error gives no hint about the version mismatch.

## WRONG
```powershell
# Assumes the latest EXO module will be loaded
Connect-ExchangeOnline -CertificateThumbprint $thumb -AppId $appId -Organization $org
# FAILS: "[outlook.office365.com] The WinRM Shell client cannot process the request..."
# Because PS7 loaded EXO 2.0.5 from ~/Documents, not 3.9.0 from Program Files
```

## RIGHT
```powershell
# Option 1: Remove the stale module from the user path
# In bash: rm -rf "~/Documents/PowerShell/Modules/ExchangeOnlineManagement"

# Option 2: Force-import by full path when multiple versions exist
Import-Module 'C:\Program Files\WindowsPowerShell\Modules\ExchangeOnlineManagement\3.9.0\ExchangeOnlineManagement.psd1' -Force
Connect-ExchangeOnline -CertificateThumbprint $thumb -AppId $appId -Organization $org
```

## NOTES
- Diagnosis: run `Get-Module ExchangeOnlineManagement` after import to verify which version loaded.
- `Get-Module -ListAvailable` shows ALL versions but doesn't tell you which one PS will pick.
- The PSModulePath order: user home > Program Files (PS7) > Program Files (PS5) > System32. First match wins.
- EXO 2.x uses Remote PowerShell (RPS/WinRM). EXO 3.x uses REST by default. They have different connection behaviors.
- OneDrive sync can resurrect removed modules if the user path is inside OneDrive -- check for that.
