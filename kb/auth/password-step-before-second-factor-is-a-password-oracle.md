---
tech: auth
tags: [password, second-factor, totp, oracle, sign-in, timing, enumeration]
severity: high
---
# A password step that answers differently for a right and a wrong password before the second factor is a password oracle

## PROBLEM
In a two-step sign-in (password, then authenticator code), answering "wrong password" at step one and "enter your code" only for a right password tells an attacker which passwords are correct without ever needing the second factor. The second factor then protects the session but not the password, which the attacker can reuse elsewhere or keep until they obtain a code.

The difference can also leak through timing: a path that skips the hash verification (unknown user, blocked account) answers faster than one that performs it.

## WRONG
```text
POST /sign-in/password
  if !verify(password, user.hash):  return 401 "wrong password"
  return 200 { next: "second_factor", pending: store_pending_session(user) }
```

## RIGHT
```text
POST /sign-in/password
  ok = verify(password, hash_or_dummy_hash)        # exactly one hash verification on EVERY path
  if ok:  pending = store_pending_session(user)
  else:   pending = random_token_same_shape()      # look-alike, never stored
  return 200 { next: "second_factor", pending }     # same answer either way

POST /sign-in/second-factor
  # A look-alike token matches no pending session, so this step fails
  # the same way as a wrong code does.
```

## NOTES
- Always answer "second factor next". The sign-in as a whole fails at the second step, where a wrong password and a wrong code are indistinguishable.
- Do exactly one hash verification on every path, including unknown users and throttled requests (verify against a fixed dummy hash), so timing does not separate the cases.
- The look-alike token must have the same length and format as a real one and must not be stored.
