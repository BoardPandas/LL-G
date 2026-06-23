---
tech: windows
tags: [windows-installer, disk-full, msp, adobe-reader, msi-com, scheduled-task, system-account, patchcleaner]
severity: high
---
# C:\Windows\Installer orphan detection: MSI COM returns 0 as SYSTEM, use the registry

## PROBLEM
`C:\Windows\Installer` bloats to 90GB+ because Adobe Acrobat Reader (and similar apps) auto-update frequently and apply a full ~680MB `.msp` patch each time; Windows caches every superseded patch forever and never purges them. The standard way to find safe-to-delete orphans is the PatchCleaner approach: enumerate installed products/patches via the `WindowsInstaller.Installer` COM object, collect each `LocalPackage`, and treat any file in `C:\Windows\Installer` not in that set as orphaned.

The trap: when the script runs in the **SYSTEM** context (e.g. a detached scheduled task used to survive a remote-session drop), `Installer.ProductsEx(...)` / `PatchesEx(...)` return **zero** products and patches with **no error** (especially with `$ErrorActionPreference='SilentlyContinue'`). The referenced set comes back empty, so EVERY `.msi`/`.msp` is flagged orphaned. Deleting on that basis wipes the live installer cache for all installed apps, breaking their repair/modify/uninstall/patching. The 1-second runtime and `referenced=0` are the only tells.

## WRONG
```powershell
# Runs fine interactively, returns 0 products under SYSTEM (scheduled task) -> all files look orphaned
$wi = New-Object -ComObject WindowsInstaller.Installer
$ref = foreach ($p in @($wi.ProductsEx($null,$null,7))) {
  $wi.ProductInfo($p.ProductCode,'LocalPackage')
  foreach ($pat in @($wi.PatchesEx($p.ProductCode,$null,7,1))) { $pat.PatchProperty('LocalPackage') }
}
# $ref is empty under SYSTEM -> every msi/msp deleted -> all installed apps lose their cache
```

## RIGHT
```powershell
# Authoritative regardless of user/SYSTEM context: read LocalPackage straight from the registry
$ref  = New-Object System.Collections.Generic.HashSet[string]([StringComparer]::OrdinalIgnoreCase)
$base = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Installer\UserData'
foreach ($sid in (Get-ChildItem $base)) {
  foreach ($prod in (Get-ChildItem "$($sid.PSPath)\Products" -EA SilentlyContinue)) {
    $lp = (Get-ItemProperty "$($prod.PSPath)\InstallProperties" -EA SilentlyContinue).LocalPackage
    if ($lp) { [void]$ref.Add($lp) }                                  # the .msi
    foreach ($pat in (Get-ChildItem "$($prod.PSPath)\Patches" -EA SilentlyContinue)) {
      $lp = (Get-ItemProperty $pat.PSPath -EA SilentlyContinue).LocalPackage
      if ($lp) { [void]$ref.Add($lp) }                                # applied .msp
    }
  }
  foreach ($pat in (Get-ChildItem "$($sid.PSPath)\Patches" -EA SilentlyContinue)) {
    $lp = (Get-ItemProperty $pat.PSPath -EA SilentlyContinue).LocalPackage
    if ($lp) { [void]$ref.Add($lp) }
  }
}

# GUARD: an empty/implausibly-small reference set means detection failed -- never delete
if ($ref.Count -lt 10) { throw "Reference set too small ($($ref.Count)); aborting to avoid nuking live packages." }

$files  = @(Get-ChildItem 'C:\Windows\Installer\*' -File -Force -Include *.msi,*.msp)  # NB: -Include needs the \* path
$orphan = $files | Where-Object { -not $ref.Contains($_.FullName) }
foreach ($f in $orphan) {
  try { $f.Attributes = 'Normal'; [IO.File]::Delete($f.FullName) }    # clear ReadOnly first or access-denied
  catch { Write-Warning "skip $($f.Name): $($_.Exception.Message)" }
}
```

## NOTES
- Always keep the all-orphan guard (`$ref.Count -lt 10`) -- see the companion entry [Windows disk-full remediation gotchas](disk-full-remediation.md), which also covers the ReadOnly-attribute delete block and DISM behavior.
- `Get-ChildItem -File -Include *.msi,*.msp` returns NOTHING without a wildcard path (`...\Installer\*`) or `-Recurse`. (PowerShell `-Include` gotcha.)
- Map a patch to its product for root-cause: `HKLM\...\UserData\<SID>\Products\<code>\Patches` `AllPatches` value lists applied GUIDs; the product's `InstallProperties\DisplayName` names it. Adobe Acrobat Reader MUI is the recurring culprit (its 2 current 541MB patches are kept; the older ~680MB copies are the orphans).
- MSI COM enumeration DOES work when run interactively in the logged-on admin's context -- the failure is specific to SYSTEM/service context. The registry method works in both, so prefer it for any unattended/scheduled-task cleanup.
- Symptom-vs-cause: cleanup reclaims the space but Reader keeps re-caching; a periodic orphaned-installer sweep is the durable fix on fleets.
