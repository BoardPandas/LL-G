---
tech: powershell
tags: [powershellget, uninstall-module, get-installedmodule, onedrive, known-folder-move, module-path, psresourceget, microsoft-graph]
severity: high
---
# OneDrive-synced modules are invisible to Get-InstalledModule and Uninstall-Module

## PROBLEM
With OneDrive Known Folder Move, the pwsh CurrentUser module path is
`C:\Users\<you>\OneDrive\Documents\PowerShell\Modules`, and OneDrive syncs it between machines.
A module installed on machine A writes `PSGetModuleInfo.xml` (CliXml) into its version folder,
recording `InstalledLocation` as A's absolute path, e.g.
`C:\Users\cvoss\OneDrive\Documents\PowerShell\Modules\Posh-SSH\3.2.7`.

On machine B the folder arrives through sync and the module loads fine, but PowerShellGet v2 does
not treat it as installed. After `Install-Module` of a newer version on B, `Get-InstalledModule
-Name X -AllVersions` returns only the new version, so `Uninstall-Module` never sees the old one.
A cleanup loop that skips when it finds one version or fewer reports success while every old
version stays on disk. `Get-Module -ListAvailable` still shows both versions.

PSResourceGet's `Get-InstalledPSResource` does list the old versions, but it reports a wrong
`InstalledLocation` for them: the other machine's path, or just the Modules root with no
`Name\Version`. Do not hand those entries to `Uninstall-PSResource`.

Observed 2026-10-01 on pwsh 7.6.6 with PowerShellGet 2.2.5, updating Microsoft.Graph
2.40.0 -> 2.41.0 (41 modules) and Posh-SSH 3.2.7 -> 4.0.0. A module installed on B itself
(Microsoft.Online.SharePoint.PowerShell) uninstalled normally in the same run.

## WRONG
```powershell
Install-Module Microsoft.Graph -Scope CurrentUser -Force -AllowClobber
foreach ($n in $names) {
    $all = @(Get-InstalledModule -Name $n -AllVersions | Sort-Object { [version]$_.Version } -Descending)
    if ($all.Count -le 1) { continue }          # synced old versions are invisible -> always skips
    $all | Select-Object -Skip 1 | ForEach-Object { Uninstall-Module -Name $n -RequiredVersion $_.Version -Force }
}
# Prints nothing to remove. 2.40.0 and 2.41.0 of every Graph submodule are still on disk.
```

## RIGHT
```powershell
# Trust the folders on disk, not PowerShellGet's install records
$base = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'PowerShell\Modules'
foreach ($modDir in @(Get-ChildItem -LiteralPath $base -Directory | Where-Object { $_.Name -like 'Microsoft.Graph*' })) {
    $vers = @(Get-ChildItem -LiteralPath $modDir.FullName -Directory |
        Where-Object { $null -ne ($_.Name -as [version]) } | Sort-Object { [version]$_.Name } -Descending)
    if ($vers.Count -le 1) { continue }
    # Only delete old versions if the newest one is really there
    if (-not (Test-Path -LiteralPath (Join-Path $vers[0].FullName "$($modDir.Name).psd1"))) { continue }
    foreach ($old in @($vers | Select-Object -Skip 1)) {
        Remove-Item -LiteralPath $old.FullName -Recurse -Force -ErrorAction Stop
    }
}
# Check with Get-Module -ListAvailable, never Get-InstalledModule.
# For Graph, confirm one distinct version across every Microsoft.Graph.* submodule.
```

## NOTES
- Diagnose it: `(Import-Clixml <Modules>\<Name>\<Version>\PSGetModuleInfo.xml).InstalledLocation`
  shows a path under another user profile or machine.
- Deletions sync back through OneDrive and remove the same versions on the other machine. That
  machine also receives the new versions, so both end in the same state. Deleted folders stay in
  the OneDrive recycle bin for 30 days.
- Package managers built on PowerShellGet (e.g. UniGetUI's "PowerShell 7.x" source) inherit the same blind spot.
- Related: graph-module-version-mismatch.md (why stale Graph versions matter),
  desktop-path-redirection.md (other OneDrive Known Folder Move traps).
