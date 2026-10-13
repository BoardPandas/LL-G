---
tech: cloudflare
tags: [cloudflare, zero-trust, access, service-token, strict-service-token-auth, 401, 403, smoke-test]
severity: medium
---
# Zero Trust orgs created on/after 2026-10-05 enforce strict service token auth

## PROBLEM
Zero Trust organisations created on or after 2026-10-05 have `strict_service_token_auth: true`, and it cannot be turned off. A request carrying a service token that Access refuses gets an HTTP 401 or 403, not the 302 redirect to the login page that older orgs return. Access Allow policies and `CF_Authorization` cookies are also ignored for service-token requests. A smoke test or client written for the old behaviour treats 401/403 as "the app is down" or "the app is public", and a test that expects a 302 never sees the refusal it is checking for.

## WRONG
```bash
# Expects a redirect to the Access login page when the app is protected
code=$(curl -s -o /dev/null -w '%{http_code}' -H "CF-Access-Client-Id: $ID" -H "CF-Access-Client-Secret: $SECRET" https://app.example.com/)
[ "$code" = "302" ] || { echo "app is not protected"; exit 1; }
```

## RIGHT
```bash
# Under strict service-token auth a refused token is 401 or 403; treat both as an Access refusal
code=$(curl -s -o /dev/null -w '%{http_code}' -H "CF-Access-Client-Id: $ID" -H "CF-Access-Client-Secret: $SECRET" https://app.example.com/)
case $code in
  401|403) echo "Access refused the service token (HTTP $code)" ;;
  *) echo "unexpected $code: check the Access application and token policy"; exit 1 ;;
esac
```

Check the organisation setting through the API before relying on either behaviour. If `service_auth_401_redirect` is set, the refusal is 401 rather than a redirect, so match 401 as well.

## NOTES
A 302 from a protected app with a service token is now a red flag, not a pass. Do not reason about Allow policies for service-token traffic: the policy that matters is the service token's own inclusion rule. Verify with a request that must be refused, not only one that must succeed.
