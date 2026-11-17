---
tech: windows
tags: [task-scheduler, schtasks, scheduled-task, laptop, battery, powershell, rmm, remote]
severity: high
---
# A scheduled task created with schtasks /Create never runs on a laptop on battery, and reports success

## PROBLEM
`schtasks /Create` (and a bare `Register-ScheduledTask` with no settings) gives the task `DisallowStartIfOnBatteries = True` and `StopIfGoingOnBatteries = True`. On an unplugged laptop, `schtasks /Run` or `Start-ScheduledTask` prints SUCCESS and the task goes to State `Queued`. `LastRunTime` is set and `LastTaskResult` reads `0`, yet the action never starts, so the output file it should write never appears. It reads as a silent success, and you go looking at your script instead of the power state.

This bites the common remote-support pattern of running long work as a detached SYSTEM task (to outlive a remote shell's timeout) on whatever machine is reachable. Laptops are often on battery when a technician reaches them.

## WRONG
```powershell
schtasks /Create /TN Sizing /SC ONCE /ST 23:59 /RU SYSTEM /RL HIGHEST /F `
  /TR "powershell.exe -NoProfile -File C:\ProgramData\Work\size.ps1"
schtasks /Run /TN Sizing        # SUCCESS
(Get-ScheduledTask Sizing).State  # Queued, forever, while on battery
```

## RIGHT
```powershell
$a = New-ScheduledTaskAction -Execute powershell.exe -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\Work\size.ps1'
$p = New-ScheduledTaskPrincipal -UserId SYSTEM -RunLevel Highest
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName Sizing -Action $a -Principal $p -Settings $s -Force | Out-Null
Start-ScheduledTask Sizing

# Fixing an existing task in place:
Set-ScheduledTask -TaskName Sizing -Settings $s
```

## NOTES
- `schtasks /Create` has no switch for the battery settings; only an XML import (`/XML`) or the ScheduledTasks cmdlets can set them.
- Detect it: `(Get-ScheduledTask X).Settings.DisallowStartIfOnBatteries` and `(Get-CimInstance Win32_Battery).BatteryStatus` (1 = discharging).
- A laptop on battery can also sleep mid-session and drop off remote management entirely. Check battery state before starting long remote work. See [aggressive-battery-sleep-unmanageable.md](aggressive-battery-sleep-unmanageable.md).
