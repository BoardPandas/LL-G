---
tech: windows
tags: [wpad, wlansvc, wcmsvc, winhttpautoproxysvc, group-policy, wifi, security-hardening, pentest-remediation, service-dependencies]
severity: high
---
# Disabling WinHttpAutoProxySvc to mitigate WPAD takes Wi-Fi down domain-wide, and is invisible on wired machines

## PROBLEM

Pentest reports routinely flag WPAD spoofing (rogue `wpad` host or `mitm6`). The obvious
remediation, and the one most hardening guides and GPO templates reach for, is to disable
the **WinHTTP Web Proxy Auto-Discovery Service** (`WinHttpAutoProxySvc`) by setting its
`Start` value to `4`.

On Windows 10 and 11 that service is a hard dependency of **Wcmsvc** (Windows Connection
Manager), which is in turn a hard dependency of **WlanSvc** (WLAN AutoConfig). Disabling it
collapses the whole chain:

```
WinHttpAutoProxySvc  Start=4 (DISABLED)    exit 1077 (never started)
  └─ Wcmsvc                                 STOPPED, exit 1068
       └─ WlanSvc                           STOPPED, exit 1068
            └─ the Wi-Fi radio              enumerated but unmanaged
```

The endpoint keeps its Wi-Fi adapter in Device Manager with **no problem code**, a healthy
driver, and `Get-PnpDevice` status `OK`. `Get-NetAdapter` reports the interface as
**Dormant** with an APIPA address and `LinkSpeed 0`. Both `Microsoft Wi-Fi Direct Virtual
Adapter` instances disappear, because WlanSvc is what creates them. The wireless controller
logs **zero association attempts** from that MAC, because the radio never probes.

Four properties make this expensive to diagnose:

1. **It is latent.** Policy does not stop an already-running service, so nothing breaks
   until each machine reboots. A domain-wide link therefore detonates one endpoint at a
   time over days, with no correlation to the change window.
2. **`Start-Service WlanSvc` hides the cause.** PowerShell reports only a generic
   `CouldNotStartService`. You must use `sc.exe start wlansvc` to see error `1068`, and then
   `sc.exe qc wcmsvc` to learn that the failing dependency is two levels down. The
   dependency list is not in the WlanSvc error.
3. **Wired machines are completely unaffected**, so servers, desktops, and anything on a
   dock stay green. Remediation is usually verified on servers, which are exactly the hosts
   that cannot show the fault.
4. **It reads as hardware.** Every symptom points at a failing Wi-Fi card, a bad driver
   update, or the patch cycle that happened to run the same night.

Observed in production: a domain-wide GPO closed the WPAD finding on 86 machines; the first
workstation to reboot lost Wi-Fi for 7.4 hours and was diagnosed as a dying Intel AX201
before the service chain was checked.

## WRONG

```powershell
# GPO / registry: "disable WPAD" by killing the service.
# Closes the pentest finding and silently takes WLAN AutoConfig with it.
Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\WinHttpAutoProxySvc' `
  -Name Start -Value 4        # 4 = Disabled

# Wi-Fi is now dead on every machine, at its next reboot.
# Diagnosis dead-ends here, because this reports nothing useful:
Start-Service WlanSvc
# Start-Service : Service 'WLAN AutoConfig (WlanSvc)' cannot be started
# due to the following error: Cannot start service WlanSvc on computer '.'.
```

## RIGHT

```powershell
# Mitigate WPAD with the setting built for it. Leave the service alone.
$k = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Internet Settings\WinHttp'
New-Item -Path $k -Force | Out-Null
New-ItemProperty -Path $k -Name DisableWpad -PropertyType DWord -Value 1 -Force

# Keep the service at its default demand-start so Wcmsvc and WlanSvc still resolve.
Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\WinHttpAutoProxySvc' `
  -Name Start -Value 3        # 3 = Manual / demand-start

# Repairing a machine already broken by the service-disable approach:
sc.exe config WinHttpAutoProxySvc start= demand
sc.exe start WinHttpAutoProxySvc
sc.exe start Wcmsvc
sc.exe start WlanSvc

# Diagnosing the chain: sc.exe gives the error code and the dependency list,
# Start-Service gives neither.
sc.exe start wlansvc      # 1068 = dependency failed
sc.exe qc wlansvc         # DEPENDENCIES: nativewifip, RpcSs, Ndisuio, wcmsvc
sc.exe qc wcmsvc          # DEPENDENCIES: RpcSs, NSI, WinHttpAutoProxySvc
sc.exe qc WinHttpAutoProxySvc   # START_TYPE : 4  DISABLED   <-- root cause
```

## NOTES

- **These settings tattoo.** Unlinking the GPO stops enforcement but does not revert the
  endpoints. Machines already hit need `Start` pushed back to `3` explicitly.
- **Verify wireless hardening on a wireless client.** A remediation validated only on
  servers or wired hosts proves nothing about WLAN, and this is the failure mode that
  exploits that gap.
- **`Ndisuio` is a decoy.** It is also a WlanSvc dependency and the usual suspect for a
  WLAN service failure, so it is easy to check it, find it `RUNNING`, and conclude the
  dependencies are fine. Read the full `sc.exe qc wcmsvc` list before ruling out the chain.
- **`DisableWpad=1` is the client-side control only.** Combine it with `wpad` and `isatap`
  in the DNS Global Query Block List on the DCs. Neither stops `mitm6`, which wins by
  becoming the DHCPv6/RA server; that needs RA Guard or DHCPv6 filtering on the switching
  and wireless gear, or IPv6 disabled via `DisabledComponents`.
- Distinguishing signature at the endpoint: adapter present with no PnP problem code,
  `Get-NetAdapter` status **Dormant**, APIPA address, `LinkSpeed 0`, Wi-Fi Direct virtual
  adapters absent, and total silence from that MAC in the wireless controller logs. A
  client with a bad PSK, an expired certificate, or a wrong VLAN would still generate
  association or authentication failures at the AP. Silence means the radio is not probing,
  which points at the OS service layer rather than at credentials, RF, or the adapter.
- Related: [The NDIS HardwareInterface flag is not a physical-adapter test](ndis-hardwareinterface-not-physical-adapter.md),
  which also concerns Wi-Fi Direct virtual adapters.
