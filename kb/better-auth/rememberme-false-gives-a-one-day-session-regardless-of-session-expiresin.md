---
tech: better-auth
tags: [session, remember-me, username-plugin, expiry]
severity: high
---
# rememberMe false gives a one-day session regardless of session.expiresIn

## PROBLEM
Signing in with `rememberMe: false` (email or username plugin) creates the session with `dontRememberMe`, which caps it at one day whatever `session.expiresIn` says.
Config suggests every session follows `expiresIn`, so a client that sends `false` sees players signed out next day with no error.

## WRONG
```ts
// expecting a 30-day session because of the config
await fetch("/api/auth/sign-in/username", {
  method: "POST",
  body: JSON.stringify({ username, password, rememberMe: false }),
});
```

## RIGHT
```ts
// send rememberMe: true (or omit it) when the session should last expiresIn;
// use false only for a deliberate short session the client will not persist
body: JSON.stringify({ username, password, rememberMe: remember }),
```

## NOTES
Better Auth 1.7.14. Pairs well with a client "Remember me" box: unticked means one-day session and nothing saved on disk.
