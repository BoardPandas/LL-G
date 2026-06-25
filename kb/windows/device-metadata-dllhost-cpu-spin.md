---
tech: windows
tags: [dllhost, device-metadata, DsmSvc, cpu-spin, performance, DeviceMetadataRetrievalClient]
severity: high
---
# Runaway dllhost (DeviceMetadataRetrievalClient) pegs a CPU core; network policy alone won't stop it, disable DsmSvc

## PROBLEM
A `dllhost.exe` hosting COM class `{6C752774-29FB-4E50-8BB1-97098425A77C}` = MetadataPackageSource (`C:\Windows\System32\DeviceMetadataRetrievalClient.dll`, the Windows device-metadata retrieval client) can get stuck in an internal spin and peg one full logical core continuously, making the machine very slow even for basic tasks. It's deceptive: the process has a tiny working set (~9 MB) and a single instantaneous "CPU load %" sample can read near 0, so it looks idle in Task Manager averages while one core is actually maxed the entire uptime (observed: 16,891 CPU-seconds over 4.7 hr = ~100% of one core).

The non-obvious part: the documented "fix" (set `PreventDeviceMetadataFromNetwork=1` and disable the `\Microsoft\Windows\Device Setup\Metadata Refresh` scheduled task) does NOT stop the live loop. Killing the dllhost just makes `DsmSvc` (Device Setup Manager) relaunch it within ~25 seconds and it resumes pegging a core. The network policy only takes effect on the next reboot. On a production box you can't reboot immediately, you'll think the fix failed.

## WRONG
```powershell
# Sets the policy + kills the process, but the loop comes right back (DsmSvc respawns it)
New-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Device Metadata' `
  -Name PreventDeviceMetadataFromNetwork -PropertyType DWord -Value 1 -Force
Disable-ScheduledTask -TaskPath '\Microsoft\Windows\Device Setup\' -TaskName 'Metadata Refresh'
Stop-Process -Name dllhost -Force   # a new dllhost for the same COM is spinning again in ~25s
```

## RIGHT
```powershell
# Diagnose: a dllhost with tiny WS but huge cumulative CPU, hosting the metadata COM
Get-CimInstance Win32_Process -Filter "Name='dllhost.exe'" |
  Where-Object { $_.CommandLine -match '6C752774-29FB-4E50-8BB1-97098425A77C' }

# Decisive no-reboot fix: stop the LAUNCHER so the COM can't respawn
Stop-Service DsmSvc -Force
Set-Service DsmSvc -StartupType Disabled          # reversible: -StartupType Manual; Start-Service DsmSvc

# Keep these too as the permanent layer (engage fully on next reboot)
New-Item -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Device Metadata' -Force | Out-Null
New-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Device Metadata' `
  -Name PreventDeviceMetadataFromNetwork -PropertyType DWord -Value 1 -Force | Out-Null
Disable-ScheduledTask -TaskPath '\Microsoft\Windows\Device Setup\' -TaskName 'Metadata Refresh'
```

## NOTES
- Disabling `DsmSvc` only stops auto-fetching device metadata/icons and some driver-setup staging; safe on fixed-config / kiosk / HMI machines. Fully reversible.
- The DeviceSetupManager Operational event log is often quiet during the spin (no per-loop events) and the local DeviceMetadataStore is tiny, so there's no single "bad device" to chase, it's the retrieval client itself spinning.
- Suspected trigger on filtered networks (e.g. Cloudflare WARP / Zero Trust blocking the metadata endpoints), but the fix above holds regardless of cause.
- First seen on Peak's FactoryTalk/Rockwell HMI site laptops (Zendesk 16472). Reboot is the proper capstone once the service is disabled.
