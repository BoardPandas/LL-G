---
tech: oauth
tags: [authorization-server, open-redirect, redirect-uri, dynamic-client-registration, client-id-metadata-document, rfc-9700, phishing]
severity: high
---
# Sending authorization errors to the client's registered redirect URI makes the server an open redirector once anyone can register a client

## PROBLEM
The classic rule is "if the client and redirect URI are valid, report authorization errors by redirecting to the redirect URI". That was safe when an administrator registered every client. With dynamic client registration or Client ID Metadata Documents, anyone can register a client whose redirect URI is their own site. A link to your `/authorize` with a deliberately invalid request (bad scope, `prompt=none` while signed out) then bounces the visitor from your trusted hostname straight to the attacker's page, with no click and no screen of yours in between.

Every protocol test passes: the redirect is exactly what the older specifications describe.

## WRONG
```text
GET /authorize?client_id=<attacker-registered>&redirect_uri=https://evil.example/cb&scope=nonsense
  client and redirect_uri match the registration -> 302 https://evil.example/cb?error=invalid_scope
```

## RIGHT
```text
if client is first-party, or the signed-in user has already approved this client:
    302 redirect_uri?error=...&state=...            # automatic redirect is acceptable
else:
    200 error page on the authorization server:
        "This request could not be completed."
        <a href="redirect_uri?error=...&state=...">Return to <redirect host></a>   # the user clicks
```

## NOTES
- RFC 9700 section 4.11.2 describes the authorization server as open redirector.
- The same trust test applies to every other "no click" behaviour: automatic approval, silent `prompt=none` answers, and remembered consent.
- Related: `kb/mcp/authorize-on-session-cookie-is-consent-bypass.md` (issuing a code to an unapproved client on cookie presence).
