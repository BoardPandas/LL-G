---
tech: meraki
tags: [licensing, co-termination, renewal, wireless, mx, budget]
severity: high
---
# Meraki co-termination: all licenses share one expiry (renew firewall AND every AP)

## PROBLEM
Most Meraki orgs use the co-termination licensing model, where EVERY license in the org (the MX security appliance/firewall license and every wireless access point license) shares ONE expiration date. Every device also needs an active license to operate at all. When budgeting a renewal it is easy to:
- price only the firewall (MX) license and forget the wireless AP licenses, or
- assume newly purchased APs "cover" the wireless side -- they only carry licenses for the units they ship with, so the retained AP fleet still expires on the co-term date.

If the co-term lapses, the firewall and Wi-Fi lose cloud management, security updates, and support.

## WRONG
```text
Renewal quote = MX firewall license only.
"The new APs include licenses, so wireless is covered." (only covers the new units)
```

## RIGHT
```text
GET /organizations/{orgId}/licenses/overview
# -> { "expirationDate": "...", "status": "OK",
#      "licensedDeviceCounts": { "MX95": 1, "wireless": 24 } }
# Renewal must cover the MX license AND all wireless AP licenses to the new co-term date.
```

## NOTES
- The co-term `expirationDate` is a hard budget deadline -- surface it even when the gear is healthy.
- Use `licensedDeviceCounts` for the renewal quantity; net wireless count may drop if separately purchased APs bring their own licenses (confirm against the co-term).
- MR Enterprise wireless licenses are model-agnostic and cover Catalyst CW APs running in Meraki mode.
