---
tech: rust
tags: [reqwest, rustls, tls, webpki-roots, certificates, cargo]
severity: high
---
# reqwest 0.13.2+ dropped webpki-roots; keep static roots with tls_certs_only

## PROBLEM
reqwest 0.13.2+ removed the `webpki-roots` feature. Its `rustls` feature now verifies
through rustls-platform-verifier, which uses the OS certificate store. Requesting the
old feature does not error; cargo silently pins reqwest to 0.13.1. Dropping the
feature to unblock the update quietly swaps your static trust roots for the OS store,
so a locally installed CA can intercept requests. The `webpki-roots` crate does not
fit here: it ships trust anchors, not certificates, and `reqwest::Certificate::from_der`
needs full DER certificates.

## WRONG
```toml
reqwest = { version = "0.13", default-features = false, features = ["blocking", "rustls", "webpki-roots"] }
# or: just delete "webpki-roots" and silently trust the OS store
```

## RIGHT
```toml
reqwest = { version = "0.13", default-features = false, features = ["blocking", "rustls"] }
webpki-root-certs = "1"
```
```rust
let roots: Vec<reqwest::Certificate> = webpki_root_certs::TLS_SERVER_ROOT_CERTS
    .iter()
    .map(|der| reqwest::Certificate::from_der(der.as_ref()))
    .collect::<Result<_, _>>()?;
let client = reqwest::blocking::Client::builder()
    .tls_certs_only(roots) // disables native/platform roots entirely
    .build()?;
```

## NOTES
Verified 2026-10-01 on reqwest 0.13.5 (Hark 0.61.5). With `tls_certs_only`, reqwest builds
a plain WebPKI verifier from those roots; without it, it uses the platform verifier.
Apply it in every builder, including test-only ones that reach real HTTPS. Related:
cargo-update-silent-holdback-on-feature-removal.md, reqwest-013-tls-feature-rename.md.
