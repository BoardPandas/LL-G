---
tech: windows-dns
tags: [active-directory, dns, ad-integrated-zone, replication, dnscmd, multi-dc, nxdomain]
severity: medium
---
# Legacy-scope AD-integrated DNS zone serves stale records on other DCs until forced reload

## PROBLEM
You add or change a record on one DC's DNS server. It resolves immediately on that DC, but a SECOND DC keeps returning "DNS name does not exist" (NXDOMAIN) for minutes, and clients pointed at the second DC fail. `repadmin /syncall` reports success and the underlying AD object replicates fine, so it looks like a replication failure but is not.

The cause: the zone is AD-integrated with `ReplicationScope = Legacy` (stored in the old `CN=MicrosoftDNS,CN=System,<domain DN>` partition, not the DomainDnsZones/ForestDnsZones app partitions). The DNS Server service loads the AD-integrated zone into memory and only re-reads AD on its `DsPollingInterval` (default 180s). So the AD object is present on the second DC, but its DNS service is still serving the cached pre-change copy. `Get-DnsServerResourceRecord` on the lagging DC shows the record missing even though the AD object replicated. A prior failed lookup can also seed a negative (NXDOMAIN) cache entry that lingers.

Detect it: `Get-DnsServerZone -Name <zone>` -> `ReplicationScope: Legacy`, `DirectoryPartitionName: MicrosoftDNS`.

## WRONG
```powershell
# Add record on DC1, then assume repadmin success == all DCs serve it
Add-DnsServerResourceRecordA -ZoneName 'corp.example.com' -Name 'nas' -IPv4Address '10.0.15.96'
repadmin /syncall /AdeP          # "SyncAll terminated with no errors"
# ...but DC2 still: Resolve-DnsName nas.corp.example.com -Server <DC2> -> NXDOMAIN
# Wrongly chase an AD replication problem (repadmin /showrepl, FRS/DFSR, etc.)
```

## RIGHT
```powershell
# After the AD object has replicated, force the lagging DC's DNS service to reload
# the AD-integrated zone from AD immediately (run on / target the lagging DC):
dnscmd <laggingDC> /ZoneUpdateFromDs corp.example.com    # Status = 0 (success)
Clear-DnsServerCache -ComputerName <laggingDC> -Force     # flush any cached NXDOMAIN

# Verify the record now resolves from the previously-lagging server:
Resolve-DnsName nas.corp.example.com -Server <laggingDC-IP>
```

## NOTES
- Remote `Clear-DnsServerCache -ComputerName <DC>` can fail on RPC ("Failed to clear cache"); run it locally on the DC (e.g. via the remote-access agent) if so.
- `dnscmd /ZoneUpdateFromDs` is the targeted fix; restarting the DNS Server service also works but is heavier. Waiting out the ~3 min DsPollingInterval resolves it on its own.
- Same gotcha applies to any AD-integrated zone change (A/PTR/CNAME) where clients use multiple DCs for DNS. Single-label names that depend on the primary DNS suffix still need the forward record in the suffix zone.
- A modern alternative is migrating the zone to a DomainDnsZones/ForestDnsZones app partition (changes ReplicationScope off Legacy), but that is a separate, planned change.
