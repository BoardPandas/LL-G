---
tech: windows
tags: [windows, powershell, wix, msi, reboot, recovery, acceptance-testing, custom-actions]
severity: high
---
# Native Windows acceptance must reconcile reboot state and scope MSI evidence

## PROBLEM
A Windows acceptance harness can falsely reject a correct build when it treats one observation as the whole truth. Windows may restore the user's baseline setting during reboot while a durable recovery record still exists, WiX can generate a new MSI ProductCode on a fresh build, and later unrelated QuietExec actions can emit errors after the custom action being tested has already completed. WixQuietExec also does not promise to echo the command line. These behaviors can make a good recovery or uninstall look broken, or can make the harness uninstall the wrong product.

## WRONG
```powershell
# Assume the target setting must survive reboot unchanged.
if ((Get-ItemPropertyValue $desktopKey FontSmoothing) -ne '0') {
  throw 'Recovery test failed'
}

# Reuse a ProductCode copied from an older build.
msiexec.exe /x '{OLD-PRODUCT-CODE}' /qn

# Attribute any later QuietExec error to the action under test and require a command echo.
if ($log -match 'Command string must begin with quoted application name' -or
    $log -notmatch '^WixQuietExec64:\s+".*cmd\.exe"') {
  throw 'C4ad cleanup failed'
}
```

## RIGHT
```powershell
# Reconcile durable recovery idempotently. The baseline may already be present after reboot,
# but the correlated record still has to be validated and cleared before reacquisition.
$baselineAlreadyPresent = (Get-ItemPropertyValue $desktopKey FontSmoothing) -eq $baseline
$record = Read-AndValidateRecoveryRecord $recordPath
if ($baselineAlreadyPresent) {
  Complete-RecoveryRecord $record
} else {
  Restore-BaselineThenCompleteRecord $record
}

# Read and pin the identity from the exact MSI being tested.
$productCode = Get-MsiProductCode $msiPath
msiexec.exe /x $productCode /qn

# Prove source/table ordering separately, including a quoted executable. For live proof,
# scope the log from this action's deferred schedule through StopServices.
$cleanupWindow = $log.Substring(
  $cleanupSchedule.Index,
  $stopServicesStart.Index - $cleanupSchedule.Index
)
$invocation = [regex]::Match($cleanupWindow, 'Entrypoint: WixQuietExec64')
$output = [regex]::Match($cleanupWindow, '(?im)^WixQuietExec64:\s+.*$')
$parseFailure = [regex]::Match(
  $cleanupWindow,
  'Command string must begin with quoted application name|invalid command line property value|Failed to get Command Line'
)
if (-not $invocation.Success -or -not $output.Success -or $parseFailure.Success) {
  throw 'Scoped deferred cleanup proof failed'
}
```

## NOTES
- A longer shutdown timeout does not prove exact restoration. Persist correlated recovery debt and block reacquisition until reconciliation completes.
- For deferred QuietExec, validate at build time that `CustomActionData` begins with a quoted executable such as `"[SystemFolder]cmd.exe"`. At runtime, use MSI `Executing op` scheduling plus the deferred invocation and output lines as proof.
- Query the exact built MSI Property table for ProductCode and use that value for registration checks and uninstall.
- Search for parse failures only inside the custom action's execution interval. A later unrelated QuietExec failure must be reported separately, not attributed to the action under test.
