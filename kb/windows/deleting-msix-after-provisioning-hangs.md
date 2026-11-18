---
tech: windows
tags: [windows, msix, appx, Add-AppxProvisionedPackage, Remove-Item, file handle, hang, powershell]
severity: medium
---
# Deleting the MSIX file right after provisioning hangs

## PROBLEM
Deleting the `.msix` file immediately after `Add-AppxProvisionedPackage` returns blocks the script. The deployment service is still working with the package file, so `Remove-Item` waits on it with no error and no timeout. A script that runs unattended stalls at that line for as long as the wait lasts, and the run looks stuck rather than failed.

The fix is to confirm that provisioning finished and then remove the file in a step with an explicit time limit.

## WRONG
```powershell
Add-AppxProvisionedPackage -Online -PackagePath $msixPath -SkipLicense | Out-Null
Remove-Item -LiteralPath $msixPath -Force    # blocks while the package is still in use
```

## RIGHT
```powershell
Add-AppxProvisionedPackage -Online -PackagePath $msixPath -SkipLicense | Out-Null

$cleanup = Start-Job -ScriptBlock {
    param($path)
    Remove-Item -LiteralPath $path -Force
} -ArgumentList $msixPath

if (-not (Wait-Job -Job $cleanup -Timeout 120)) {
    Stop-Job -Job $cleanup
    throw "Timed out removing $msixPath after provisioning"
}
Receive-Job -Job $cleanup -ErrorAction Stop | Out-Null
Remove-Job -Job $cleanup
```

## NOTES
- Remove the file only after `Get-AppxProvisionedPackage -Online` lists the package, so a failed provisioning does not lose the installer.
- Bound every wait in an unattended script. An unbounded wait looks the same as a crashed job.
