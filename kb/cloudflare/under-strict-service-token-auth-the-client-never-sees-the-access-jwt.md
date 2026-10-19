---
tech: cloudflare
tags: [zero-trust, access, service-token, strict-service-token-auth, jwt, cf-authorization, common-name, testing]
severity: medium
---
# Under strict service-token auth the client never sees the Access JWT

## PROBLEM
In a Zero Trust organisation with strict service-token authentication, a client never sees the Access JWT. A request Access accepts on a service token gets no `Set-Cookie` and no `CF_Authorization` cookie. Every org created on or after 2026-10-05 has strict mode (see `cloudflare/zero-trust-orgs-created-on-after-2026-10-05-enforce-strict-service-token-auth`). The JWT Access signs for the request travels only from Access to the origin, in the `Cf-Access-Jwt-Assertion` request header.

So an origin check built on a claim cannot be inspected from outside: binding a bearer token to the service token's `common_name`, or reading `aud`, `exp` or a custom claim. A plan to curl the app and decode the cookie finds nothing to decode.

## WRONG
```bash
# Expecting a cookie to decode after a service-token request
curl -s -D - -o /dev/null -H "CF-Access-Client-Id: $ID" -H "CF-Access-Client-Secret: $SECRET" \
  https://api.example.com/whoami | grep -i '^set-cookie: CF_Authorization='   # prints nothing
```

## RIGHT
Prove a claim-based check by how the origin behaves, with a positive and a negative case:
```bash
# 1. Each credential pair passes on its own: 200.
curl -s -o /dev/null -w '%{http_code}\n' -H "CF-Access-Client-Id: $A_ID" -H "CF-Access-Client-Secret: $A_SECRET" \
  -H "Authorization: Bearer $A_BEARER" https://api.example.com/whoami
# 2. Cross them. A's bearer with B's service token passes Access, so the origin must refuse it.
curl -s -w '\n%{http_code}\n' -H "CF-Access-Client-Id: $B_ID" -H "CF-Access-Client-Secret: $B_SECRET" \
  -H "Authorization: Bearer $A_BEARER" https://api.example.com/whoami   # 403 from the origin, naming the check
```
Have the origin's refusal name the check that failed, so the crossed test can tell an origin refusal from an Access one. To see the claims themselves, log the verified payload's non-secret fields at the origin, or return them from a debug route that you remove afterwards.

## NOTES
- Observed on a strict organisation. A valid service token got a 200 through Access with no `Set-Cookie` header. A wrong or missing token got a 401 from Access, because the app has `service_auth_401_redirect` on.
- The origin must still verify the JWT from `Cf-Access-Jwt-Assertion` on every request. Strict mode changes what the client sees, not what the origin must check.
- Cloudflare's documented sample `common_name` is the Client ID with an `.access` suffix, and a client cannot confirm that either. Normalise both sides (strip `.access`) before comparing.
- With no session cookie, every request must carry the service-token headers.
