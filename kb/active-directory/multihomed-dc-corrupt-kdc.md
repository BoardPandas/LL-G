---
tech: active-directory
tags: [domain-controller, kerberos, replication, dns, multihomed, dcpromo, kdc, sysvol]
severity: high
---
# Multi-homed DC + stale DNS corrupts a newly promoted DC's local KDC (unrepairable)

## PROBLEM
A newly promoted DC cannot authenticate logins; inbound replication fails `5 (0x5) Access is denied`; it cannot register its own NETLOGON SRV records (events 5774/5781); Directory Service 2088 "could not use DNS to resolve the source DC." The trap is that the secure channel looks healthy, so you chase replication ACLs and machine passwords for hours while the real fault is a corrupt local KDC that no resync, password reset, or reboot will fix.

Two compounding root causes:
1. **Multi-homed source DC.** The existing DC has two NICs on the SAME subnet, both registering in DNS. Clients/DCs resolve it round-robin and hit asymmetric source-address replies, producing intermittent Kerberos/replication "Access denied." Server 2019 Netlogon ignores `SkipAsSource` and re-registers every live IP, so disabling DNS-client registration is not enough; you must remove the IP/NIC. A phantom/old demoted DC left in `_msdcs` SRV records makes it worse.
2. **Resolver hits its own empty zone via ::1.** The new DC runs DNS with an unreplicated (empty) zone; with IPv6 enabled its resolver uses `::1` (itself) and gets NXDOMAIN even though IPv4 DNS points at the healthy DC. `nslookup` reveals `Server: ::1`.

The decisive diagnostic: `nltest /sc_verify` (Netlogon) PASSES while `klist get host/<dc>` returns substatus **0x52e** with 0 cached tickets and `repadmin` says "Access denied." Stop the local KDC (`Stop-Service Kdc`): if the DC then gets TGTs from the OTHER DC and SYSVOL/replication start working, its local KDC/ntds.dit is corrupt. Such a DC is NOT repairable.

## WRONG
```powershell
# Promote a second DC into a broken-DNS environment, then try to repair in place
Install-ADDSDomainController -DomainName contoso.local -InstallDns   # DNS still points at multi-homed/empty resolver
# ...auth fails, so chase it forever:
repadmin /replicate NEWDC OLDDC "DC=contoso,DC=local" /full         # "Access is denied (5)"
nltest /sc_change_pwd /server:NEWDC                                  # secure channel was never the problem
Restart-Service NTDS ; Restart-Computer                             # klist still returns 0x52e after every reboot
# Force-demote also fails on SYSVOL/DFSR: "the operation identifier is not valid"
Uninstall-ADDSDomainController -ForceRemoval                         # blocked, because initial sync never created the SYSVOL membership
```

## RIGHT
```powershell
# 1. FIX DNS/networking FIRST, before (re)promoting:
#    - Single-home the source DC: physically remove the 2nd IP/NIC (SkipAsSource is ignored on 2019).
#    - Purge phantom/old-DC records from _msdcs and forward zones.
#    - On the new DC set DNS to the HEALTHY partner DC only (not itself) and, during bootstrap,
#      disable the IPv6 binding so the empty local zone can't shadow lookups via ::1.

# 2. Confirm the local KDC is the fault, not the secure channel:
nltest /sc_verify:contoso.local        # PASS  -> secure channel is fine
klist get host/oldedc.contoso.local    # 0x52e + 0 tickets -> Kerberos validation broken
Stop-Service Kdc                        # if TGTs/SYSVOL now work via the other DC, local KDC is corrupt

# 3. A DC whose own KDC can't validate its machine account after /full resync + sc_change_pwd +
#    NTDS restart + clean reboot is unrepairable. Do NOT in-place repair. When force-demote is
#    blocked on SYSVOL/DFSR, do metadata cleanup on a HEALTHY DC, then rebuild the VM fresh:
Remove-ADObject "CN=NTDS Settings,CN=NEWDC,CN=Servers,CN=Default-First-Site-Name,CN=Sites,CN=Configuration,DC=contoso,DC=local" -Recursive -Confirm:$false
Remove-ADObject "CN=NEWDC,CN=Servers,CN=Default-First-Site-Name,CN=Sites,CN=Configuration,DC=contoso,DC=local" -Recursive -Confirm:$false
Get-ADComputer NEWDC | Remove-ADObject -Recursive -Confirm:$false
# then purge the dead DC's SRV/CNAME/A records, rebuild the VM with a SINGLE NIC, point DNS at the
# healthy DC BEFORE promotion, and Install-ADDSDomainController cleanly.
```

## NOTES
- Diagnostic shorthand: **sc_verify OK + klist 0x52e + repadmin "Access denied" = corrupt local KDC, not a secure-channel/ACL problem.**
- Never boot the corrupt instance back as a DC after metadata cleanup; rebuild from a fresh image.
- The whole failure cascades from DNS: get DNS and single-homing correct BEFORE you run dcpromo, and the second DC promotes cleanly the first time.
- Related: stale Legacy-scope AD-integrated DNS zones (see windows-dns index) and demoted-DC SRV record cleanup.
