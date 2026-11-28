---
tech: auth
tags: [session, session-fixation, step-up, password-change, cookie, csrf-token, rotation]
severity: high
---
# Not rotating the session identifier at step-up or password change lets a copied cookie ride the owner's re-authentication

## PROBLEM
If the session value stays the same when a session gains privilege (step-up re-authentication, second factor completed, password changed), anyone holding a copy of the cookie from before gains the new privilege the moment the real owner re-authenticates. A password change that keeps the old session value also fails to evict whoever prompted the change.

A second, visible effect once it is fixed: a CSRF token derived from the session value changes with it, so a page that keeps using the token it read at load gets its next POST refused.

## WRONG
```text
POST /step-up
  verify(second_factor)
  session.stepped_up_at = now        # same cookie value as before
```

## RIGHT
```text
POST /step-up
  verify(second_factor)
  new = mint_session(user, stepped_up_at = now)
  revoke(old_session)
  set_cookie(new.value)              # the old value no longer works
  return { csrf: csrf_for(new) }     # the page must take the new CSRF token
```

## NOTES
- Mint a new session value at every privilege change: sign-in, second factor, step-up, password or passkey change, and when privilege is dropped.
- The client must re-read the CSRF token after such a call (from the response, or by re-fetching the endpoint that serves it). Test the request that follows a step-up, not only the step-up.
