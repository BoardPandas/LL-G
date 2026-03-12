---
tech: powershell
tags: [modules, graph, version, assembly]
severity: high
---
# All Microsoft.Graph.* submodules must be the same version

## PROBLEM
If `Microsoft.Graph.Authentication` is v2.25 and `Microsoft.Graph.Applications` is v2.24, you get assembly loading errors at runtime. The errors are cryptic and don't point to version mismatch as the cause.

## WRONG
```powershell
# Installing modules at different times without checking alignment
Install-Module Microsoft.Graph.Authentication -Force
# ... later ...
Install-Module Microsoft.Graph.Applications -Force
# Versions may differ if PSGallery published updates between installs
```

## RIGHT
```powershell
$requiredModules = @('Microsoft.Graph.Authentication', 'Microsoft.Graph.Applications')
$versions = @()
foreach ($mod in $requiredModules) {
    $installed = Get-Module -ListAvailable -Name $mod |
        Sort-Object Version -Descending | Select-Object -First 1
    if (-not $installed) {
        Install-Module -Name $mod -Scope CurrentUser -Force -AllowClobber
        $installed = Get-Module -ListAvailable -Name $mod |
            Sort-Object Version -Descending | Select-Object -First 1
    }
    $versions += $installed.Version
}

# Version mismatch check
if (@($versions | Select-Object -Unique).Count -gt 1) {
    Write-Host "Graph module version mismatch ($($versions -join ' vs ')). Updating..." -ForegroundColor Yellow
    foreach ($mod in $requiredModules) {
        Install-Module -Name $mod -Scope CurrentUser -Force -AllowClobber
    }
}

foreach ($mod in $requiredModules) {
    Import-Module $mod -ErrorAction Stop
}
```

## NOTES
- This extends the `modules.md` entry which mentions version pinning in its notes
- The detection pattern uses `@($versions | Select-Object -Unique).Count` -- don't forget the `@()` wrapper (see `array-safety.md`)
- `-AllowClobber` prevents conflicts when updating side-by-side versions
