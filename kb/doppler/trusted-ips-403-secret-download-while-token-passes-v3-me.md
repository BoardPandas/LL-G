---
tech: doppler
tags: [trusted-ips, service-token, http-403, egress-ip, migration, fly-io]
severity: high
---
# Doppler trusted IPs return 403 on secret download while the same token passes /v3/me

## PROBLEM
A Doppler config with trusted IPs refuses secret downloads from any other source IP with HTTP 403. The same service token still gets 200 from `GET /v3/me`. So every "is this token valid?" check passes, and the 403 reads as a token or permissions problem.

It bites on a platform move. The new apps boot with the same service token, but their egress IPs are not on the list, so they fail to fetch secrets at startup. Meanwhile the old platform keeps working, which seems to prove the token is fine.

## WRONG
```bash
# From the new platform
curl -s -o /dev/null -w '%{http_code}\n' -u "$DOPPLER_TOKEN:" https://api.doppler.com/v3/me
# 200 -> "token is fine", so the 403 on download gets debugged as a token problem
```

## RIGHT
```bash
# 1. Give the new app static egress IPs (Fly: an IPv4 + IPv6 pair per region)
fly ips allocate-egress -a <app> -r <region>

# 2. Add each address to every config the app reads, as /32 and /128,
#    with a token allowed to edit the config (not the app's service token)
curl -s -X POST -u "$DOPPLER_ADMIN_TOKEN:" -H 'Content-Type: application/json' \
  "https://api.doppler.com/v3/configs/config/trusted_ips?project=<project>&config=<config>" \
  -d '{"ip":"192.0.2.10/32"}'
curl -s -X POST -u "$DOPPLER_ADMIN_TOKEN:" -H 'Content-Type: application/json' \
  "https://api.doppler.com/v3/configs/config/trusted_ips?project=<project>&config=<config>" \
  -d '{"ip":"2001:db8::10/128"}'

# 3. Test the call that actually failed, from the new platform -- not /v3/me
curl -s -o /dev/null -w '%{http_code}\n' -u "$DOPPLER_TOKEN:" \
  "https://api.doppler.com/v3/configs/config/secrets/download?format=json"
```

## NOTES
- Allow-listing whatever IP a new app happens to egress from today breaks later. Without static egress IPs, a platform's shared egress addresses can change under you.
- Trusted IPs are set per config. Check every config the new app reads, not just the main one.
- Scaling a service into another region gives it different egress IPs, and this same 403 then hits only part of the traffic.
