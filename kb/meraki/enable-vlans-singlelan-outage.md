---
tech: meraki
tags: [mx, vlans, single-lan, dhcp-reservations, trunk-port, drop-untagged, outage, dashboard-api]
severity: high
---
# Enabling VLANs on a single-LAN MX wipes reservations AND blackholes the untagged network

## PROBLEM
Turning on VLANs on a Meraki MX that was in single-LAN (no-VLAN) mode has two destructive side effects. Both will take down a live site if you do this on the fly:

1. **Reservations are wiped.** The former single-LAN `fixedIpAssignments` and `reservedIpRanges` do NOT migrate to the auto-created default VLAN 1 -- they come back empty. DHCP can then lease into your static-infrastructure range (APs/switches) and devices that relied on fixed IPs (printers, POS, cameras) drift.

2. **Untagged traffic is blackholed (full LAN outage).** Enabling VLANs sets every MX LAN port to `type:trunk, dropUntaggedTraffic:true` with NO native VLAN. The existing flat network is UNtagged (UniFi/other switches send VLAN 1 native-untagged), so the MX silently drops all of it. APs, servers, POS, and the management controller lose their gateway within ~2 minutes. The dashboard shows the MX online (it reaches the cloud over WAN) while the entire LAN is dark, which masks the cause.

Identify the real uplink port with `GET /devices/{serial}/lldpCdp` -- do not trust the topology API's port labels (real case: topology reported MX "Port 3" but LLDP showed the true uplink was MX port 5).

## WRONG
```http
# Live network. Just flip VLANs on and start building the new VLAN.
PUT /networks/{networkId}/appliance/vlans/settings
{ "vlansEnabled": true }
# -> default VLAN 1 now has empty fixedIpAssignments + reservedIpRanges
# -> all LAN ports now trunk/dropUntaggedTraffic:true with no native VLAN
# -> entire untagged VLAN1 flat network (APs, servers, POS, controller) is blackholed
```

## RIGHT
```http
# Do this in a maintenance window, in order:

# 1. Back up the single-LAN config FIRST (capture reservations + reserved ranges)
GET /networks/{networkId}/appliance/singleLan

# 2. Enable VLANs
PUT /networks/{networkId}/appliance/vlans/settings   { "vlansEnabled": true }

# 3a. Immediately restore reservations/ranges onto VLAN 1
PUT /networks/{networkId}/appliance/vlans/1
{ "fixedIpAssignments": { ... }, "reservedIpRanges": [ ... ] }

# 3b. Immediately set in-use LAN/uplink ports to native VLAN 1 so untagged traffic survives
PUT /networks/{networkId}/appliance/ports/{portId}
{ "type": "trunk", "dropUntaggedTraffic": false, "vlan": 1, "allowedVlans": "all" }

# 4. Verify the flat network is still up (org device statuses / client list) BEFORE proceeding
# 5. Only now create the new VLAN and tag the SSID/ports onto it
```

## NOTES
Recovery was ~1-2 minutes after the port fix (untagged frames map back to VLAN 1). Real-world incident caused a ~9-minute total LAN outage at a live country club. After the fix the staff-VLAN cutover completed cleanly. Related: the UniFi "VLAN must be tagged on every switch between AP and MX" trunk-gap gotcha -- once segmenting, confirm the new VLAN traverses the whole switch path. Side note seen during the same incident: the MX's static WAN1 dropped and failed over to WAN2 around the same window (appeared unrelated to the LAN/VLAN changes).
