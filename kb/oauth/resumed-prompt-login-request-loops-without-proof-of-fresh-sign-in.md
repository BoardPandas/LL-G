---
tech: oauth
tags: [authorization-server, openid-connect, prompt-login, max-age, sign-in, redirect-loop, query-size-limit, percent-encoding]
severity: medium
---
# A resumed prompt=login / max_age=0 request loops forever unless the return trip carries proof of the fresh sign-in

## PROBLEM
Two failures in the "send the user to sign in, then resume the authorization request" round trip:

1. `prompt=login` and `max_age=0` mean "authenticate the user again now". The server sends the user to the sign-in page with the original request attached, and the sign-in page returns to `/authorize` with that same request. The request still says `prompt=login`, so the server sends the user to sign in again, forever.
2. The server caps the raw query string of `/authorize` at the same size as its cap on the decoded parameters. The resumed request is carried percent-encoded inside a `return_to`-style parameter, so it is larger than the original. The server then refuses its own resumed request, although the original was within the limit.

## WRONG
```text
/authorize?prompt=login&...      -> 302 /sign-in?return_to=<encoded /authorize?prompt=login&...>
/sign-in (success)               -> 302 /authorize?prompt=login&...      # nothing says "just signed in"
/authorize?prompt=login&...      -> 302 /sign-in?...                      # loop

MAX_RAW_QUERY = MAX_DECODED_QUERY   # the encoded resumed request no longer fits
```

## RIGHT
```text
/sign-in (success) -> 302 /authorize?...&<proof of fresh sign-in>
# The proof is something the server can verify and a caller cannot forge.
# With it, the forced re-authentication is treated as done; without it,
# prompt=login / max_age=0 sends the user to sign in.

MAX_RAW_QUERY > MAX_DECODED_QUERY   # leave room for percent-encoding of your own resumed request
```

## NOTES
- Do not "fix" the loop by stripping `prompt=login` on the return trip without a proof: then any link without the parameter skips the re-authentication the client asked for.
- Test the whole round trip with the longest request you accept, not only the first hop.
