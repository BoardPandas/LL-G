---
tech: hyper-v
tags: [hyper-v, dynamic-memory, startup-ram, vm-wont-start, not-enough-memory, windows-server, virtualization]
severity: medium
---
# Dynamic Memory does not lower a VM's boot-time RAM allocation

## PROBLEM
Enabling Dynamic Memory on a Hyper-V VM does NOT reduce how much RAM the host must have free to start it. The **Startup RAM** is what Hyper-V allocates up front at boot, and only after the guest is running does it balloon DOWN toward the Minimum. Minimum RAM never reduces the boot requirement.

The trap is in the UI: when Dynamic Memory is enabled, the plain **"RAM"** field at the top of the Memory settings page IS the Startup RAM. People set Minimum=2048 / Maximum=8192, assume the VM will now boot on 2 GB, and leave the top "RAM" field at its old 8192. The VM still requests 8192 MB at start and fails on a host that can't spare it.

Symptom (Hyper-V-Worker Admin event log):
- Event 3122: `Not enough memory in the system to start the virtual machine <name> with ram size 8192 megabytes`
- Event 3050: `could not initialize memory: Not enough memory resources are available ... (0x8007000E)`
- Event 12030: `'<name>' failed to start`

Related: with **static (fixed)** memory, the VM needs its entire assigned RAM free at start PLUS Hyper-V keeps a root-partition reserve. A host reporting ~9.8 GB free can still refuse to start an 8 GB static VM, because that would leave the root partition below its safety reserve. The "free" figure also fluctuates with file cache, so it can dip under the requested amount moment to moment.

## WRONG
```text
Memory settings (Dynamic Memory enabled):
  RAM (Startup):  8192 MB   <-- still the old value
  Minimum RAM:    2048 MB
  Maximum RAM:    8192 MB
Result: VM fails to start, event 3122 "... with ram size 8192 megabytes"
```
```powershell
# Only setting Min/Max leaves Startup untouched
Set-VMMemory -VMName SGCCFILEDC -DynamicMemoryEnabled $true `
  -MinimumBytes 2GB -MaximumBytes 8GB
# StartupBytes is still 8GB -> still won't boot on a tight host
```

## RIGHT
```text
Memory settings (Dynamic Memory enabled):
  RAM (Startup):  2048 MB   <-- set the top field to the LOW value
  Minimum RAM:    2048 MB
  Maximum RAM:    8192 MB
Result: boots at 2 GB, grows toward 8 GB on demand when host has spare RAM
```
```powershell
# Set Startup low along with Min/Max (VM must be Off)
Set-VMMemory -VMName SGCCFILEDC -DynamicMemoryEnabled $true `
  -StartupBytes 2GB -MinimumBytes 2GB -MaximumBytes 8GB -Buffer 20

# Diagnose a start failure: confirm physical free vs requested
Get-CimInstance Win32_OperatingSystem |
  Select @{n='FreeGB';e={[math]::Round($_.FreePhysicalMemory/1MB,2)}}
Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-Hyper-V-Worker-Admin'} -MaxEvents 20 |
  Where-Object Id -in 3050,3122,12030
```

## NOTES
- Dynamic Memory is supported on virtualized **domain controllers** since Server 2012, but set Startup=Minimum (e.g. both 2 GB) so AD's ESE/NTDS cache is sized from a sane baseline and never squeezed below boot level. The old "never on a DC" advice is a Server 2008 R2 artifact.
- Do NOT use Dynamic Memory for **SQL Server** VMs (it balloons the buffer pool; Standard edition doesn't hot-add). Keep SQL VMs on static RAM with `max server memory` capped.
- Right-size vCPUs too: vCPU count does not reserve physical cores (Hyper-V time-slices logical processors), so an over-provisioned VM isn't "out of CPU," but excess idle vCPUs add co-scheduling overhead. A DC/file server runs fine on 2-4 vCPUs.
- Real-world: SGCC-HOST-2026 (Server 2025, 32 GB host already running a 16 GB static SQL VM) could not start the 8 GB SGCCFILEDC VM until Startup RAM was dropped to 2 GB via Dynamic Memory.
