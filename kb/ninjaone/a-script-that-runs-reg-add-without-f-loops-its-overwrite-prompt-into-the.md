---
tech: ninjaone
tags: [reg-add, disk-space, script-output, scripting-folder, low-disk-alert, cmd]
severity: high
---
# A script that runs reg add without /f loops its overwrite prompt into the NinjaOne output log until the disk is full

## PROBLEM
An unattended NinjaOne script that runs `reg add` on a value that already exists, without `/f`, hangs on `Value exists, overwrite(Yes/No)?` and the agent's captured output can loop that prompt forever into `C:\ProgramData\NinjaRMMAgent\scripting\<script>-output.txt`, growing it to tens or hundreds of GB.
The first run succeeds (the value does not exist yet), so the script looks fine in testing. Every later scheduled run hits the prompt. The NinjaOne console shows the run as failed or timed out, never "filled the disk". The symptom surfaces weeks later as a low-disk alert, and a quick look at C:\Users can wrongly blame user data. Files of 94 to 319 GB were seen on several devices, and a hung `reg.exe` from an old run can still be waiting on the prompt after the script is fixed.

## WRONG
```cmd
REG ADD HKLM\SYSTEM\CurrentControlSet\Control\SafeBoot\Network\MyAgentService /t REG_SZ /d Service
```

## RIGHT
```cmd
REG ADD HKLM\SYSTEM\CurrentControlSet\Control\SafeBoot\Network\MyAgentService /t REG_SZ /d Service /f
```
```powershell
# Or idempotent PowerShell, which never prompts:
New-Item -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SafeBoot\Network\MyAgentService' -Force |
  Set-ItemProperty -Name '(default)' -Value 'Service'

# When triaging a low-disk alert on a NinjaOne-managed box, size this first:
Get-ChildItem C:\ProgramData\NinjaRMMAgent\scripting -File -Force |
  Where-Object Length -gt 100MB | Select-Object Length, LastWriteTime, Name

# Delete a log only after its head and tail are confirmed to be the prompt loop,
# then end any reg.exe still hung from a pre-fix run:
Get-CimInstance Win32_Process -Filter "Name='reg.exe'" | Select-Object ProcessId, CreationDate, CommandLine
```

## NOTES
Any interactive prompt in an unattended RMM script can do this (`del` without `/q`, `choice`, `pause`). Not every hung run loops; some sit at 0 bytes, so a stale `reg.exe` can be present without a large file. Fixing the library script does not stop runs already in progress on endpoints.
