---
tech: powershell
tags: [powershell-7, system-web, password-generation, dotnet-core, cross-version]
severity: high
---
# System.Web is .NET Framework only -- not available in PowerShell 7+

## PROBLEM

`Add-Type -AssemblyName System.Web` and types like `[System.Web.Security.Membership]::GeneratePassword(...)` are commonly used in Windows PowerShell 5.1 scripts to generate passwords. They fail in PowerShell 7+ because the `System.Web` assembly ships with .NET Framework only, not .NET Core / .NET 5+ / .NET 7+ which `pwsh` runs on.

The failure mode is misleading: `Add-Type -AssemblyName System.Web` may even succeed silently in some pwsh setups (returning no error), but the type lookup `[System.Web.Security.Membership]` then throws `Unable to find type [System.Web.Security.Membership]`. Scripts that work fine when launched from `powershell.exe` will explode when the same script is launched from `pwsh` (which is what most modern automation, CI, and bash-invoked scripts do).

This bites password-generation utilities especially hard because they are routinely lifted from old Stack Overflow answers written for PS 5.1.

## WRONG

```powershell
# Works in Windows PowerShell 5.1, FAILS in PowerShell 7+
Add-Type -AssemblyName System.Web
$tempPass = [System.Web.Security.Membership]::GeneratePassword(16, 3)
# pwsh error: Unable to find type [System.Web.Security.Membership]
```

## RIGHT

```powershell
# Hand-rolled generator -- works in both PS 5.1 and PS 7+
function New-StrongPassword {
    param([int]$Length = 16)
    $upper  = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZ'
    $lower  = [char[]]'abcdefghijkmnopqrstuvwxyz'
    $digit  = [char[]]'23456789'
    $symbol = [char[]]'!@#$%^&*-_=+'
    $all = $upper + $lower + $digit + $symbol
    do {
        # Guarantee at least one of each character class
        $pw = @(($upper | Get-Random), ($lower | Get-Random), ($digit | Get-Random), ($symbol | Get-Random))
        $pw += 1..($Length - 4) | ForEach-Object { $all | Get-Random }
        $pw = ($pw | Sort-Object { Get-Random }) -join ''
    } while ($pw -notmatch '[A-Z]' -or $pw -notmatch '[a-z]' -or $pw -notmatch '\d' -or $pw -notmatch '[^A-Za-z0-9]')
    return $pw
}
$tempPass = New-StrongPassword -Length 16
```

For cryptographically stronger output, replace `Get-Random` with `[System.Security.Cryptography.RandomNumberGenerator]::GetBytes(...)` -- both `RandomNumberGenerator` and `Get-Random` work cross-version, but `Get-Random` is not crypto-strength.

## NOTES

- Same problem applies to other `System.Web.*` types: `HttpUtility`, `HttpServerUtility`, etc. Use `System.Net.WebUtility` (cross-platform) for HTML/URL encoding.
- The repo's own `CLAUDE.md` mandates `pwsh` for all .ps1 scripts (rule #1 under PowerShell Script Rules), so any new password-generation code in this codebase must avoid `System.Web` entirely.
- Related: `[System.Drawing.*]`, `[System.Configuration.ConfigurationManager]`, and `[System.DirectoryServices.AccountManagement]` also have caveats on .NET Core / pwsh -- treat any `System.Web` / `System.Drawing` / `System.Configuration` reference in a script as a portability red flag.
