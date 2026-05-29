---
tech: unifi
tags: [site-manager, api, cloud, coverage, controller, ubiquiti]
severity: high
---
# UniFi Site Manager cloud key only covers that account -- not all client sites

## PROBLEM
The UniFi Site Manager API (`api.ui.com`, `X-API-KEY` header) only returns the consoles, sites, and devices belonging to the specific Ubiquiti cloud account the key was minted in. A locally-managed or self-hosted UniFi controller (or a site under a different cloud account) does NOT appear. It is wrong to conclude "this client has no UniFi gear" or "no switches" just because the shared cloud key returns nothing for them.

## WRONG
```text
GET https://api.ui.com/v1/sites   # via the shared client key
# client X not in the results -> report "client X has no UniFi switches"  (WRONG)
```

## RIGHT
```text
GET https://api.ui.com/v1/hosts | /sites | /devices   # enumerate what the key can see
# If the client's site is absent, the gear is likely on a local controller or another
# account -> confirm with the client / verify on-site. Do NOT report zero devices.
```

## NOTES
- Cloud API host is `api.ui.com`; a local controller exposes a different API on `:8443`.
- One shared "client" key can legitimately cover several clients and miss others; treat absence as "unknown / verify," not "none."
- Honor rate limits; responses are wrapped (`{ "data": [...] }`).
