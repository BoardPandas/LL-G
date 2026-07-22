---
tech: windows-dns
tags: [active-directory, dns, scavenging, aging, zone-root, netlogon, dc-location, split-brain]
severity: high
---
# Aging without scavenging fills the AD zone root and silently breaks DC location

## PROBLEM

Enabling **aging** on an AD-integrated zone without also enabling **scavenging** on the DNS server is not a half-measure, it is a slow leak. Aging stamps dynamic records with a timestamp; scavenging is the separate, server-level setting that actually deletes them once stale. Turn on the first and not the second and records accumulate forever.

Where this becomes dangerous is the **zone root** (the `@` / "same as parent folder" record). Domain members resolve the bare domain name to locate the domain, so every A record at the zone root is treated as a candidate domain controller. Legitimately only DCs belong there. In practice client registrations land there too and never get cleaned up.

Once the zone root holds N addresses, a domain lookup is a round-robin across all of them, so the chance of reaching a real DC is roughly 1-in-N. Clients retry until something answers, which surfaces to users as "everything randomly stalls for a while and then recovers" rather than as a clean failure. Nothing logs an obvious root cause.

Real case: `bellehavencc.com` zone root held **142 A records** (136 dynamic client registrations, 6 static). Two were the actual DC. The rest were workstations, POS terminals, a guest-WiFi client, a CGNAT address, and five Cloudflare edge IPs. Aging was on at 3d/3d; `ScavengingState` was `False` and the server had never scavenged. Fingerprint on the clients was **NETLOGON 5719** ("This computer was not able to set up a secure session with a domain controller"), 21 occurrences in 30 days on a single workstation.

The split-brain variant makes it worse: when the AD domain name is also the public web domain, someone inevitably adds the website's public A record at the AD zone root so staff can browse to the bare domain internally. Those static records then compete with the DC for domain-location lookups permanently, and they survive any scavenging cleanup because they are static.

## WRONG

```powershell
# Aging enabled, scavenging never turned on. Records get timestamps and immortality.
Set-DnsServerZoneAging -Name 'corp.example.com' -Aging $true `
    -RefreshInterval 3.00:00:00 -NoRefreshInterval 3.00:00:00
# ...and then never running Set-DnsServerScavenging. This is the leak.

# Assuming a healthy-looking zone is fine because name resolution "works":
Resolve-DnsName corp.example.com     # returns AN answer, so it looks OK
# It returns an answer every time. It just isn't the DC most of the time.

# Chasing the symptom instead: blaming the WAN, the switch, the endpoints,
# or the users' browsers for recurring intermittent slowness.
```

## RIGHT

```powershell
$zone = 'corp.example.com'

# 1. AUDIT: how many A records are at the zone root? Should be DC count, not 100+.
$root = Get-DnsServerResourceRecord -ZoneName $zone -RRType A -Name '@'
"total : $($root.Count)"
"static: $(@($root | Where-Object { $_.Timestamp -eq $null }).Count)"
$root | ForEach-Object { "{0}  static={1}" -f $_.RecordData.IPv4Address, ($_.Timestamp -eq $null) }

# 2. Confirm the actual misconfiguration: aging on, scavenging off.
Get-DnsServerZoneAging -Name $zone | Select-Object AgingEnabled,NoRefreshInterval,RefreshInterval
Get-DnsServerScavenging | Select-Object ScavengingState,ScavengingInterval,LastScavengeTime

# 3. SNAPSHOT BEFORE DELETING. Write a real rollback, not just a CSV.
$dir = 'C:\dns-cleanup'; New-Item -ItemType Directory -Path $dir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$root | Select-Object HostName,
    @{n='IP';e={$_.RecordData.IPv4Address.IPAddressToString}},
    @{n='TTL';e={$_.TimeToLive.ToString()}},Timestamp |
    Export-Csv "$dir\zoneroot-$stamp.csv" -NoTypeInformation

# 4. Purge ONLY dynamic records, and keep every DC IP.
$keep = @('10.0.0.8')          # every real DC, verify with: nltest /dclist:$zone
$del  = @($root | Where-Object {
    $_.Timestamp -ne $null -and $keep -notcontains $_.RecordData.IPv4Address.IPAddressToString })
$del | ForEach-Object {
    "Add-DnsServerResourceRecordA -ZoneName '$zone' -Name '@' -IPv4Address '$($_.RecordData.IPv4Address)' -TimeToLive ([TimeSpan]'$($_.TimeToLive)')"
} | Set-Content "$dir\rollback-$stamp.ps1"
foreach ($r in $del) { Remove-DnsServerResourceRecord -ZoneName $zone -InputObject $r -Force }

# 5. Close the leak, or it refills.
Set-DnsServerScavenging -ScavengingState $true -ScavengingInterval 7.00:00:00 -ApplyOnAllZones

# 6. Verify DC location actually recovered, from a CLIENT not just the DC.
nltest /dsgetdc:corp.example.com     # must name a real DC
nltest /sc_query:corp.example.com    # must return NERR_Success
```

## NOTES

**Do the purge as one self-contained script in a single session.** Half-deleting a zone root because a remote session dropped is a bad place to stop. Snapshot and rollback get written before the first deletion, not after.

**Static records survive scavenging.** Enabling scavenging does nothing about deliberately-added static entries, including the split-brain website records. Removing those fixes DC location but breaks internal browsing to the bare domain, so it needs a split-DNS decision (usually: steer staff at `www.`) rather than a quiet delete.

**Scavenging is two settings, not one.** `Set-DnsServerZoneAging` (per zone) and `Set-DnsServerScavenging` (per server). Having only the first is the failure described here, and it looks configured at a glance because the zone properties show aging enabled.

**Why clients register at the zone root in the first place is worth chasing separately.** In the case above it was never determined, and dynamic update was set to `Secure`, meaning these were legitimate domain members doing it. Scavenging stops the accumulation but does not stop the behavior, so the count will creep back up.

**Related:** if the zone is `ReplicationScope = Legacy`, also read [legacy-zone-stale-secondary-dc.md](legacy-zone-stale-secondary-dc.md). A Legacy-scope zone compounds this because other DCs will not see your cleanup until their next AD poll (~180s) or a forced `dnscmd /ZoneUpdateFromDs`.

**Fingerprint to recognize it fast:** recurring NETLOGON 5719 on clients, intermittent and unattributable "the network is slow" reports across the site, and a `Resolve-DnsName <domain>` that returns far more addresses than you have DCs.
