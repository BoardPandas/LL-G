---
tech: auth
tags: [rate-limit, lockout, failed-attempts, transaction, rollback, brute-force, sign-in]
severity: high
---
# Counting failed attempts inside the request's own transaction loses the count when that transaction rolls back

## PROBLEM
A sign-in handler opens one transaction for the request, increments the failed-attempt counter in it, and then returns an error for the wrong password. The error path rolls the transaction back, and the increment goes with it. The counter never rises, so the lockout or throttle never triggers, and nothing fails: every response is still a correct "wrong password".

A test that reads the counter inside the same transaction, or that only checks the response, passes.

## WRONG
```text
begin tx
  user = lookup(tx, name)
  if !verify(password, user.hash):
      increment_failures(tx, user.id)     # written in the request transaction
      return Err(BadCredentials)           # error path -> rollback -> increment lost
commit tx
```

## RIGHT
```text
begin tx
  user = lookup(tx, name)
  ok = verify(password, user.hash)
  ...
end tx (commit or rollback)

if !ok:
    record_failure(pool, user.id, client_address)   # its own transaction, after the request's
    return Err(BadCredentials)
```

## NOTES
- Either record the failure on a separate connection/transaction, or record it after the request transaction has ended. Do not rely on the request transaction committing on an error path.
- Test it from outside: make N failing requests, then read the counter on a fresh connection.
- The same applies to audit rows for refused actions: a refusal recorded in a transaction that the refusal rolls back leaves no record.
