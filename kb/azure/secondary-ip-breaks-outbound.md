---
tech: azure
tags: [azure, networking, secondary-ip, nic, snat, nat-gateway, outbound, skipassource, accelerated-networking, run-command, powershell]
severity: high
---
# Binding secondary IPs on an Azure VM's primary NIC silently kills all outbound when the subnet has no NAT gateway

## PROBLEM
On an Azure VM whose subnet has **no NAT gateway** and `defaultOutboundAccess=False`, outbound internet exists ONLY via the primary ipconfig's instance-level public IP, and Azure SNAT covers only the primary IP. Add secondary private IPs and bind them **inside the guest on the same adapter that owns the default route**, and Windows can pick a secondary (which has no egress path) as the outbound source address. That drops ALL outbound traffic, including the primary's: RMM agents (SupportForge / NinjaRMM) go offline and the Azure guest agent can flip to "Not Ready", which also wedges Run Command. The tell is a *running* VM (boot-diagnostics console shows the login screen) that cannot phone home on any channel.

Three things make this a silent trap:
- `SkipAsSource=$true` is supposed to prevent it, but `New-NetIPAddress -SkipAsSource` does **not** reliably apply the flag.
- **Reboot AND redeploy do not fix it** — the broken guest static config persists on the OS disk and rides through both (redeploy reuses the same disk).
- The data-plane channel you used to add the IP (RMM/RDP) drops the instant the adapter resets, so the change can land half-applied and you lose your way back in.

## WRONG
```powershell
# Single NIC that also carries the default route + the only egress (public IP).
# Adding guest secondaries here can hijack the host's outbound source -> total offline.
$if = (Get-NetIPAddress -IPAddress 10.0.0.8 -AddressFamily IPv4).InterfaceAlias  # primary NIC
'10.0.0.12','10.0.0.13','10.0.0.14' | ForEach-Object {
    New-NetIPAddress -InterfaceAlias $if -IPAddress $_ -PrefixLength 24 -SkipAsSource $true
}
# ...run over the RMM/RDP data-plane channel, which the adapter reset also kills mid-command.
```

## RIGHT
```powershell
# Put the extra IPs on a DEDICATED second NIC. A secondary Azure NIC gets NO default
# gateway, so its IPs can never be selected as the host's outbound source. Host internet
# stays on NIC1 (.8); emulator/app IPs live on NIC2. Bind + verify atomically via Azure
# Run Command (fabric path), not RDP/RMM.
$emuIf = (Get-NetIPAddress -IPAddress 10.0.0.19 -AddressFamily IPv4).InterfaceAlias  # 2nd NIC
'10.0.0.12','10.0.0.13','10.0.0.14','10.0.0.15' | ForEach-Object {
    New-NetIPAddress -InterfaceAlias $emuIf -IPAddress $_ -PrefixLength 24 -SkipAsSource $true -EA SilentlyContinue
    Set-NetIPAddress  -IPAddress $_ -SkipAsSource $true -EA SilentlyContinue   # make SkipAsSource actually stick
}
(Get-NetRoute -DestinationPrefix '0.0.0.0/0').ifIndex           # expect exactly one, on the HOST NIC
(Test-NetConnection 8.8.8.8 -Port 53).TcpTestSucceeded          # verify outbound in the SAME operation
```

## NOTES
- Alternative fix: add a **NAT Gateway** to the subnet — every IP then gets guaranteed outbound SNAT regardless of Windows source selection, so even secondaries on the primary NIC become safe.
- Recovery when already stranded (box unreachable, reboot/redeploy won't clear it): swap in a fresh NIC (or use Azure **Serial Console**, which works over the COM port with no network). When moving NICs, remember the instance-level **public IP** and **Accelerated Networking** live on the old NIC, and the primary **private IP changes unless it was Static** — reassociate/re-enable as needed.
- VM NIC cap is small (e.g. `Standard_D4as_v6` = 2 NICs), so "dedicated NIC" scales to one extra adapter; for more isolation use a NAT gateway.
- Discovered on Peak Technical Solutions VM PTSSTUDIO5K-1 (Rockwell emulator host needing ~5-10 alternate IPs for emulated devices), 2026-07-06.
