---
tech: rust
tags: [reqwest, rustls, tls, cargo, features, webpki]
severity: medium
---
# reqwest 0.13 renamed the 0.12 TLS umbrella features

## PROBLEM
Guides, LLM training data, and older lockfiles use reqwest 0.12 feature names
like `rustls-tls-webpki-roots` / `rustls-tls-native-roots`. reqwest 0.13
removed those umbrella features and split them: the backend is now `rustls`
and the trust-root source is a separate feature (`webpki-roots` or
`rustls-native-certs`). Cargo fails resolution with "package `X` depends on
`reqwest` with feature `rustls-tls-webpki-roots` but `reqwest` does not have
that feature" — obvious once seen, but easy to burn time on because most
documentation still shows the 0.12 names.

## WRONG
```toml
reqwest = { version = "0.13", default-features = false, features = [
    "blocking", "rustls-tls-webpki-roots", "json",
] }
```

## RIGHT
```toml
reqwest = { version = "0.13", default-features = false, features = [
    "blocking", "rustls", "webpki-roots", "json",
] }
# or "rustls-native-certs" instead of "webpki-roots" for the OS cert store
```

## NOTES
Verified 2026-07-15 on reqwest 0.13.1 (Hark STT spike). Static webpki roots
avoid OS cert-store surprises on Windows; pick `rustls-native-certs` only if
you need corporate/proxy CAs.
