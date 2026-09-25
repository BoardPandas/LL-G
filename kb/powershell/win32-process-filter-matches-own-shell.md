---
tech: powershell
tags: [processes, Win32_Process, Stop-Process, remote-execution]
severity: high
---
# Filtering Win32_Process by CommandLine matches the shell running the filter

## PROBLEM
When a script is passed on the command line (remote agents, `powershell -Command`, RMM tools), the running PowerShell's own CommandLine contains the script text, including the pattern. `Where-Object { $_.CommandLine -like '*C:\app\*' } | Stop-Process` kills the shell itself partway through. The remote tool reports only a generic failure (for example `exit status 0xffffffff`) with no output, and the later lines never run.

## WRONG
```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*C:\app\venv\*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## RIGHT
```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.ProcessId -ne $PID -and $_.ExecutablePath -like 'C:\app\venv\*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```
