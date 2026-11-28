---
tech: thunderbird
tags: [thunderbird, add-on, webextension, manifest, oauth-provider, web-ext, lint, redirection-endpoint, trailing-slash]
severity: medium
---
# Thunderbird add-ons: web-ext lint does not validate oauth_provider manifest keys, and the trailing slash of redirectionEndpoint is significant

## PROBLEM
Two traps when a Thunderbird add-on registers an OAuth provider through its manifest:

1. **`web-ext lint` does not validate the `oauth_provider` keys.** A misspelt key inside `oauth_provider` lints clean. The add-on installs, the provider is not registered as intended, and nothing points at the manifest.
2. **The trailing slash of `redirectionEndpoint` is significant.** Thunderbird only replaces the port in the redirection endpoint; the rest of the string is used as written. `http://localhost/` and `http://localhost` are therefore different redirect URIs, and the authorization server refuses whichever one it did not register.

## WRONG
```text
- Treat a clean `web-ext lint` as proof that the oauth_provider block is correct.
- Register "http://localhost/" on the authorization server while the manifest's
  redirectionEndpoint says "http://localhost" (or the reverse).
```

## RIGHT
```text
- Check every key in the oauth_provider block against the schema by hand, or with a test
  that loads the manifest and compares the key names with an explicit list.
- Make redirectionEndpoint and the redirect URI registered on the authorization server
  identical character for character apart from the port, including the trailing slash.
- Verify with a real sign-in in Thunderbird; lint cannot see either problem.
```

## NOTES
- Symptom of the second problem: the authorization server reports a redirect URI mismatch although the two values look the same at a glance.
