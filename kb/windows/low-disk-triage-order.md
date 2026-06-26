---
tech: windows
tags: [disk-cleanup, dell-supportassist, windows-temp, windows-installer, triage, ninjaone, supportforge]
severity: medium
---
# Low-disk triage order: Dell SA snapshots are NOT always the cause, even on Dell hardware

## PROBLEM
On low-disk remediation it is tempting to assume the cause is Dell SupportAssist
SARemediation snapshots, because that is the dominant pattern on club/POS Dell
fleets. Acting on that assumption wastes the visit: on a real fleet sweep a Dell
Latitude (IAFC2023-006) had `C:\ProgramData\Dell\SARemediation` at only 0.27 GB
while `C:\Windows\Temp` held 12.2 GB, and a Surface Laptop 5 (JEFFCOMPUTER, not a
Dell at all) had `C:\Windows\Installer` at 50 GB (20 GB orphaned). Stopping the
Dell SupportAssist Remediation service would have freed nothing on either box.
The hardware vendor does not predict the cause; only measurement does.

## WRONG
```powershell
# Assume Dell SA snapshots because it's a Dell, stop+delete+disable, then declare victory.
$svc = 'Dell SupportAssist Remediation'
Stop-Service $svc -Force
[System.IO.Directory]::Delete('C:\ProgramData\Dell\SARemediation\SystemRepair\Snapshots', $true)
Set-Service $svc -StartupType Disabled
# Freed 0.27 GB; disk still at 4.8% free. Cause was elsewhere.
```

## RIGHT
```powershell
# Size the top culprits FIRST (read-only), then act on whatever is actually large.
$paths = 'C:\ProgramData\Dell\SARemediation','C:\Windows\Temp',
         'C:\Windows\Installer','C:\Windows\SoftwareDistribution\Download','C:\Windows\CSC'
foreach ($p in $paths) {
  if (Test-Path $p) {
    $sz = (Get-ChildItem -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue |
           Measure-Object Length -Sum).Sum
    '{0,-45} {1,8:N2} GB' -f $p, [math]::Round($sz/1GB,2)
  }
}
# Then: Windows\Temp + WU cache + recycle bin are SAFE auto-clean.
# Windows\Installer > 10 GB -> registry-LocalPackage orphan purge (see installer-orphan-detection-registry.md).
# Dell SA snapshots -> only when SARemediation is actually the bulk (see dell-supportassist-snapshot-bloat.md).
```

## NOTES
- Cheapest correct triage: `Windows\Temp`, `Windows\Installer`, WU `Download`, `CSC`,
  and the top user profiles. SAFE-tier cleanup (Temp / WU cache / recycle bin) often
  clears the 5% alert by itself without touching any vendor-specific store.
- The `C:\Windows\Installer` orphaned-.msp bloat pattern is not limited to Dell or to
  clubs: it appeared on an IAFC Surface Laptop 5 (50 GB Installer, 120/192 files = 20 GB
  orphaned). Detect via registry `LocalPackage` with an all-orphan guard and clear the
  ReadOnly attribute before `[IO.File]::Delete` (see installer-orphan-detection-registry.md).
- Related: dell-supportassist-snapshot-bloat.md, installer-orphan-detection-registry.md,
  disk-full-remediation.md. SupportForge gotchas (recursive-delete block, sub-1%-free
  hung executor) live in kb/supportforge/llms.txt.
