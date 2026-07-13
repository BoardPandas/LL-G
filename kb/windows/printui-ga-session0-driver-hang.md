---
tech: windows
tags: [printing, printui, per-machine-connection, session-0, point-and-print, driver-staging, pnputil, remote-admin]
severity: high
---
# printui /ga hangs forever in session 0 when the shared printer's driver is not pre-installed

## PROBLEM
Adding a per-machine printer connection with `rundll32 printui.dll,PrintUIEntry /ga /n"\\server\share"` from a SYSTEM / session-0 context (RMM agent, remote shell, scheduled task) hangs indefinitely with no error when the client does not already have the share's driver installed. Point-and-Print wants to show a driver-trust/install dialog, but session 0 has no interactive desktop, so the dialog renders invisibly and rundll32 waits on it forever. Nothing is written to the PrintService log; the registry key under `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Print\Connections` never appears. It looks like the command was accepted and is "just slow."

## WRONG
```powershell
# From a SYSTEM remote session on the client -- hangs forever, no output, no event
rundll32 printui.dll,PrintUIEntry /ga /n"\\FILE\Main Copier"
```

## RIGHT
```powershell
# 1. On the print server, find the driver package and stage it somewhere the client
#    machine account can read (print$ is readable by Everyone):
Get-PrinterDriver -Name 'Canon Generic Plus PCL6' | Select-Object InfPath
Copy-Item 'C:\Windows\System32\DriverStore\FileRepository\cnp60ma64.inf_amd64_<hash>\*' `
  'C:\Windows\System32\spool\drivers\_staging_cnp60' -Recurse

# 2. On the client (SYSTEM is fine), pre-install the driver into the driver store:
Copy-Item '\\FILE\print$\_staging_cnp60\*' 'C:\Windows\Temp\cnp60' -Recurse
pnputil /add-driver 'C:\Windows\Temp\cnp60\CNP60MA64.INF' /install
Add-PrinterDriver -Name 'Canon Generic Plus PCL6'

# 3. NOW the per-machine add returns instantly (exit 0) -- nothing left to prompt about.
#    Wrap in a guarded wait so a hang can never strand the session:
$p = Start-Process rundll32.exe -ArgumentList 'printui.dll,PrintUIEntry /ga /n"\\FILE\Main Copier"' -PassThru
if (-not $p.WaitForExit(60000)) { Stop-Process -Id $p.Id -Force }

# 4. Verify registration, then restart the spooler to surface the connection for users:
Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Print\Connections'
Restart-Service Spooler
```

## NOTES
- Per-machine connections (`/ga`) are the right tool when the remote session runs as SYSTEM: `Add-Printer -ConnectionName` creates a per-USER connection for SYSTEM, which the logged-in user never sees.
- The connection only becomes visible to users after a spooler restart (or reboot); the registry entry alone is not enough.
- Clean up both staging copies (server share subfolder and client temp) afterward -- driver packages run 50-100 MB.
- Related: [pointprint-nonwhql-driver-trust.md](pointprint-nonwhql-driver-trust.md) covers the interactive-session variant of the same trust prompt (Event 600 / 800702e4 for non-admins).
