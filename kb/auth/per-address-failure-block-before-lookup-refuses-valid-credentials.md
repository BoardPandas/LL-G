---
tech: auth
tags: [rate-limit, lockout, nat, per-ip, bearer-token, device-credential, denial-of-service, throttle]
severity: high
---
# A per-address failure block consulted before the credential lookup refuses valid credentials

## PROBLEM
A common throttle design: count failed authentications per client address, and once the count passes a limit refuse every attempt from that address before looking the credential up. Behind an office or carrier NAT many people share one address, so a few junk attempts from one of them (or from an attacker on the same network) lock out everyone behind it, valid credentials included. The server reports it as ordinary throttling, so it looks like the system working.

For random 256-bit tokens the block protects nothing: there is nothing to guess.

## WRONG
```text
if failures(client_address) >= LIMIT:
    return 429                      # refuses the valid token too
cred = lookup(token)
if cred is None:
    record_failure(client_address)
    return 401
```

## RIGHT
```text
# Random high-entropy tokens: look up first.
cred = lookup(token)
if cred is valid:
    return ok                       # a valid credential always succeeds
# It fails anyway; the failure budget only decides how cheaply.
if failures(client_address) >= LIMIT:
    return 429                      # short answer, no further work
record_failure(client_address)
return 401
```

## NOTES
- For passwords, guessing is real, so a per-address bucket is still needed: charge **failures**, not successes, to it, so correct sign-ins from a shared address do not consume the budget.
- A plain request-rate limit (requests per second, regardless of outcome) can still sit in front of the lookup; it bounds load without turning other people's failures into your refusal.
- Test: exhaust the failure budget from one address, then present a valid credential from the same address and require success.
