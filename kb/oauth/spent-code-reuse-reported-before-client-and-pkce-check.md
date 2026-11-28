---
tech: oauth
tags: [authorization-server, authorization-code, replay, revocation, pkce, token-endpoint, denial-of-service]
severity: high
---
# Reporting a spent authorization code as reused before checking the client and PKCE verifier lets anyone who saw the code revoke the user's tokens

## PROBLEM
The recommended response to a replayed authorization code is to revoke the tokens that were issued from it. If the token endpoint decides "this code was already used, revoke" before it checks that the request comes from the right client with the right PKCE verifier, then anyone who merely saw the code (a browser history entry, a referrer, a log line, a proxy) can present it and sign the real user out. They cannot get tokens, but they can revoke them, as often as they like.

## WRONG
```text
POST /token  code=C
  row = lookup(C)
  if row.spent:
      revoke_tokens_issued_from(row)     # before any proof of who is asking
      return 400 invalid_grant
  check client, check PKCE verifier ...
```

## RIGHT
```text
POST /token  code=C
  row = lookup(C)
  client_ok   = authenticated client == row.client
  verifier_ok = pkce_matches(code_verifier, row.code_challenge)
  if row.spent:
      if client_ok and verifier_ok:
          revoke_tokens_issued_from(row)  # a real replay by the code's own holder
      return 400 invalid_grant            # same answer either way
```

## NOTES
- Revoke on replay only when both the client and the verifier match. A request that fails either check gets `invalid_grant` and changes nothing.
- Test: redeem a code, then replay it with a wrong verifier and assert the first token pair still works.
