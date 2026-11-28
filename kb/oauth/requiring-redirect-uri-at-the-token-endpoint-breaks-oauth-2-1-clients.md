---
tech: oauth
tags: [authorization-server, token-endpoint, redirect-uri, oauth-2-1, pkce, interoperability]
severity: medium
---
# OAuth 2.1 removed redirect_uri from the token request, so a server that requires it breaks clients that follow only 2.1

## PROBLEM
OAuth 2.0 (RFC 6749) has the client repeat `redirect_uri` when it exchanges an authorization code. OAuth 2.1 removed the parameter from the token request: PKCE is mandatory there and does the job of binding the code to the party that started the flow. A token endpoint written from RFC 6749 that answers `invalid_request` or `invalid_grant` when `redirect_uri` is absent refuses clients written against 2.1 only, while every 2.0-style client and test keeps working.

## WRONG
```text
POST /token  grant_type=authorization_code&code=...&code_verifier=...
  if redirect_uri is missing:  400 invalid_request      # breaks 2.1-only clients
```

## RIGHT
```text
POST /token  grant_type=authorization_code&code=...&code_verifier=...
  require code_verifier and verify it against the stored challenge   # PKCE is mandatory
  if redirect_uri is present and != the one used at /authorize:  400 invalid_grant
  if redirect_uri is absent:  continue                                # do not require it
```

## NOTES
- Compare it when sent; do not require it.
- Add a token-endpoint test with no `redirect_uri` at all, and one with a wrong `redirect_uri`.
