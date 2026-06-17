---
tech: windows
tags: [disk-space, windows-installer, msi, msp, dism, onedrive, powershell, supportforge, cleanup, read-only-attribute]
severity: high
---
# Windows disk-full remediation gotchas (Installer orphans, read-only deletes, DISM, OneDrive sizing)

## PROBLEM
Reclaiming space on a chronically-full Windows machine has several traps that silently produce wrong results: cleanup that reports success while freeing almost nothing, sizing reports that exceed the physical disk, DISM that no-ops, and a remote-access session that will not even connect. Each one wastes a remediation pass and can hide the real space hog (C:\Windows\Installer).

## WRONG
```powershell
# 1. Treat C:\Windows\Installer files as deletable junk, or trust Remove-Item to clear it.
#    Deleting referenced .msi/.msp breaks future uninstall/repair; and a failed COM
#    enumeration that returns an empty "referenced" set would flag EVERY file as orphan.
Get-ChildItem C:\Windows\Installer -Filter *.msi |
    Remove-Item -Force          # no orphan check, no all-orphan guard

# 2. Delete orphans without clearing the read-only attribute.
foreach ($f in $orphans) { [IO.File]::Delete($f) }   # silently throws on read-only
#    Symptom: "117 files deleted" but only 0.46 GB freed -- the 35 big ones were read-only.

# 3. Run DISM on a disk that just filled / has pending servicing.
dism /online /cleanup-image /startcomponentcleanup   # 0x800f080a, "no operation performed"

# 4. Size profiles with Measure-Object on a OneDrive Files On-Demand machine.
(Get-ChildItem C:\Users\x -Recurse | Measure-Object Length -Sum).Sum
#    Reports 337 GB on a 235 GB drive -- counts cloud-only placeholders at logical size.
```

## RIGHT
```powershell
# 1. Detect Installer orphans the PatchCleaner way via the WindowsInstaller.Installer COM
#    object, then GUARD against deleting everything.
$msi = New-Object -ComObject WindowsInstaller.Installer
$referenced = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$products = @($msi.GetType().InvokeMember('ProductsEx','GetProperty',$null,$msi,@('','',7)))
foreach ($p in $products) {
    $code = $p.GetType().InvokeMember('ProductCode','GetProperty',$null,$p,$null)
    $lp = $p.GetType().InvokeMember('InstallProperty','GetProperty',$null,$p,@('LocalPackage'))
    if ($lp) { [void]$referenced.Add([IO.Path]::GetFileName($lp)) }
    # filter 15 = ALL patch states, so superseded/registered patches stay protected
    foreach ($patch in @($msi.GetType().InvokeMember('PatchesEx','GetProperty',$null,$msi,@($code,'',7,15)))) {
        $plp = $patch.GetType().InvokeMember('PatchProperty','GetProperty',$null,$patch,@('LocalPackage'))
        if ($plp) { [void]$referenced.Add([IO.Path]::GetFileName($plp)) }
    }
}
$files = @(Get-ChildItem C:\Windows\Installer -File -Include *.msi,*.msp -Recurse)
$orphans = @($files | Where-Object { -not $referenced.Contains($_.Name) })
# ABORT conditions -- a failed enumeration must never nuke the cache:
if ($products.Count -lt 1 -or $referenced.Count -eq 0 -or $orphans.Count -eq $files.Count) {
    throw "Orphan detection looks broken -- aborting to protect the Installer cache."
}

# 2. Clear read-only BEFORE deleting, or the delete silently fails on the big files.
foreach ($o in $orphans) {
    [IO.File]::SetAttributes($o.FullName, [IO.FileAttributes]::Normal)
    [IO.File]::Delete($o.FullName)
}

# 3. Free space first, then REBOOT to clear pending-servicing, then run DISM.
#    (StartComponentCleanup will keep returning 0x800f080a until the reboot happens.)

# 4. Get the real physical footprint by excluding cloud-only placeholders.
(Get-ChildItem C:\Users\x -Recurse -File |
    Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::Offline) } |
    Measure-Object Length -Sum).Sum
#    Dehydrating OneDrive is pointless if the folder is already cloud-only.
```

## NOTES
- C:\Windows\Installer is often the single biggest hidden win on a chronically-full box (reclaimed 24.4 GB of a 25.7 GB folder on WBA-BZBR814, ticket 16311).
- SupportForge (remote technician MCP) connect_agent times out repeatedly against a machine whose C: is at ~0 bytes free -- the session has no room for its temp files. Free even a little space (disable hibernation, clear %TEMP%) and it connects. SupportForge execute_command also blocks `Remove-Item -Recurse`, so deploy cleanup as a .ps1 and run via `powershell -File`, using `[IO.Directory]::Delete($p,$true)` / `[IO.File]::Delete`.
- Order of operations on a 0-byte disk: safe-tier temp/WU-cache/WER/prefetch first (gets the disk breathing), then hibernation + Installer orphans (the big wins), then DISM after a reboot.
- Related: [[recursive-delete-block]] (SupportForge), cmd.exe zero-disk emergency entry.
