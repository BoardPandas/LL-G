---
tech: powershell
tags: [modules, dependencies, requires, installation]
severity: medium
---
# Runtime module checks instead of #Requires -Modules

## PROBLEM
`#Requires -Modules` halts the entire script with a hard error if the module is not installed, with no opportunity to install it automatically. It also does not enforce version pinning in a useful way and cannot install missing modules.

## WRONG
```powershell
#Requires -Modules Microsoft.Graph
#Requires -Modules ExchangeOnlineManagement

# Script body -- never reached if modules are missing
```

## RIGHT
```powershell
# Check and install at runtime
$requiredModules = @(
    @{ Name = 'Microsoft.Graph.Users'; MinVersion = '2.0.0' }
    @{ Name = 'ExchangeOnlineManagement'; MinVersion = '3.0.0' }
)

foreach ($mod in $requiredModules) {
    if (-not (Get-Module -ListAvailable -Name $mod.Name | Where-Object { $_.Version -ge $mod.MinVersion })) {
        Write-Host "Installing $($mod.Name)..."
        Install-Module -Name $mod.Name -MinimumVersion $mod.MinVersion -Force -Scope CurrentUser
    }
    Import-Module -Name $mod.Name -MinimumVersion $mod.MinVersion -ErrorAction Stop
}
```

## NOTES
- When using multiple `Microsoft.Graph.*` submodules, pin them all to the same version to avoid assembly conflicts
- `Install-Module` requires `-Scope CurrentUser` if not running as administrator
- `-Force` on `Install-Module` suppresses the untrusted repository prompt; use only with PSGallery or a trusted source
- `Import-Module` with `-ErrorAction Stop` will catch import failures (e.g., assembly conflicts) in your `try/catch`
