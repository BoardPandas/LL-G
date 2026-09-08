---
tech: windows
tags: [winget, powershell, localsystem, software-deployment, service]
severity: high
---
# WinGet CLI is unsupported under LocalSystem

## PROBLEM
A software deployment works in an administrator's interactive terminal but fails from the Windows service account. WinGet CLI execution is unsupported under LocalSystem. Finding winget.exe in WindowsApps does not make that execution context supported. Microsoft supports the Microsoft.WinGet.Client PowerShell module for machine-wide applications instead.

## WRONG
```go
// This service runs as LocalSystem.
exec.CommandContext(ctx, "winget.exe", "install", "--id", packageID).Run()
```

## RIGHT
Use a fixed internal PowerShell wrapper, with validated exact ID/version supplied as data rather than interpolated script text:
```powershell
Import-Module Microsoft.WinGet.Client -ErrorAction Stop
$result = Install-WinGetPackage -Id $package.packageId -Version $package.version -Source winget -MatchOption Equals -Mode Silent -Scope System -Confirm:$false
if ($result.Status -ne 'Ok') { throw 'WinGet installation failed' }
```

## NOTES
Provision the module for AllUsers and the machine-wide WinGet dependencies. Restrict module discovery to administrator-controlled locations. Verify the configured source is the official catalog. Use Update-WinGetPackage for an installed older package. Read the structured result, including reboot requirements; PowerShell process exit zero alone is not installation evidence. Perform independent application detection after the operation.

Microsoft documents the account restriction and supported alternative at https://learn.microsoft.com/en-us/windows/package-manager/winget/troubleshooting . Cmdlet parameters: https://github.com/microsoft/winget-cli/blob/master/src/PowerShell/Help/Microsoft.WinGet.Client/Install-WinGetPackage.md .
