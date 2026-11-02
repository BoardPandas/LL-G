---
tech: windows
tags: [laps, registry, local-admin, netapi32, rmm-agent, password-rotation]
severity: high
---
# Windows LAPS policy lives in four registry roots that never merge; check one and you fight LAPS silently

## PROBLEM
A third-party agent that manages a local admin must detect Windows LAPS, and checking one registry key (or merging values across keys) misses it, so both rotate the same account.

Windows LAPS reads four policy roots in precedence order, and the first root holding ANY explicit value wins outright; settings are never merged across roots:
1. CSP/Intune: `HKLM\Software\Microsoft\Policies\LAPS`
2. Group Policy: `HKLM\Software\Microsoft\Windows\CurrentVersion\Policies\LAPS`
3. Local config: `HKLM\Software\Microsoft\Windows\CurrentVersion\LAPS\Config`
4. Legacy LAPS: `HKLM\Software\Policies\Microsoft Services\AdmPwd`, active when the legacy AdmPwd client-side extension is registered under `HKLM\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\GPExtensions\<legacy-laps-cse-guid>` (the GUID is listed on Microsoft Learn `laps-scenarios-legacy`)

The commonly guessed `HKLM\Software\Policies\LAPS` is not a root. On the winning root, `BackupDirectory` 0 disables everything, 1 is Entra, 2 is AD. An empty `AdministratorAccountName` means the RID-500 account. On 24H2+, `AutomaticAccountManagementEnabled=1` ignores `AdministratorAccountName` and uses a `WLapsAdmin` name/prefix (optionally with a random suffix).

## WRONG
```powershell
# One guessed key; misses Intune/CSP and GPO, and ignores precedence
$p = Get-ItemProperty 'HKLM:\Software\Policies\LAPS' -ErrorAction SilentlyContinue
if (-not $p) { Manage-OurAdmin }   # fights Windows LAPS on Intune-managed PCs
```

## RIGHT
```powershell
$roots = 'HKLM:\Software\Microsoft\Policies\LAPS',
         'HKLM:\Software\Microsoft\Windows\CurrentVersion\Policies\LAPS',
         'HKLM:\Software\Microsoft\Windows\CurrentVersion\LAPS\Config'
$active = $roots | Where-Object {
  (Get-Item $_ -ErrorAction SilentlyContinue).ValueCount -gt 0 } | Select-Object -First 1
if ($active) {
  $cfg = Get-ItemProperty $active
  if ($cfg.BackupDirectory -ne 0) { return 'managed-by-windows-laps' }  # back off
} elseif (Test-Path "HKLM:\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\GPExtensions\$LegacyLapsCseGuid") {
  return 'managed-by-legacy-laps'
}
# Also never touch the account LAPS names, RID 500, or the WLapsAdmin prefix.
```

## NOTES
- Same code path, second trap: `NetUserSetInfo` level 1008 replaces the whole flag word. Read the current flags with `NetUserGetInfo` first, preserve other bits, and always include `UF_SCRIPT`.
- `NetUserSetInfo` can return `ERROR_POLICY_CONTROLLED_ACCOUNT` (0x21CE) when Windows LAPS guards the account; treat it as "managed by LAPS", not a transient error.
- Setting `HKLM\...\LAPS\Config\BackupDirectory=0` is the documented kill switch for legacy emulation.
- Sources: Microsoft Learn `laps-management-policy-settings`, `laps-scenarios-legacy`, `laps-concepts-overview`, NetUserSetInfo.
