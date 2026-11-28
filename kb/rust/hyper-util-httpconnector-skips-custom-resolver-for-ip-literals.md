---
tech: rust
tags: [hyper-util, hyper-rustls, httpconnector, resolver, ssrf, ip-literal, alpn, panic]
severity: high
---
# hyper-util's HttpConnector skips a custom resolver when the host is an IP literal; hyper-rustls with_tls_config panics if ALPN is already set

## PROBLEM
Two traps when building an outbound HTTP client on `hyper-util` and `hyper-rustls`:

1. **Resolver bypass.** A common way to block server-side request forgery is a custom DNS resolver that drops private, loopback and link-local addresses. `HttpConnector` only calls the resolver for host **names**. When the URL's host is an IP literal (`http://127.0.0.1/`, `http://[::1]/`, `http://169.254.169.254/`) it connects directly and the resolver, with its filter, never runs. Tests that use hostnames pass.
2. **ALPN panic.** `hyper-rustls`'s `with_tls_config` panics if the `rustls::ClientConfig` passed to it already has ALPN protocols set. The builder sets ALPN itself from the HTTP versions you enable.

## WRONG
```rust
// The filter lives only in the resolver:
let connector = HttpConnector::new_with_resolver(FilteringResolver::new());
// GET http://169.254.169.254/latest/meta-data/  -> connects; the resolver was never asked.

let mut tls = rustls::ClientConfig::builder() /* ... */;
tls.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
let https = hyper_rustls::HttpsConnectorBuilder::new().with_tls_config(tls); // panics
```

## RIGHT
```rust
// 1. Refuse IP literals when validating the URL, before any connection is attempted.
match url.host() {
    Some(url::Host::Domain(_)) => {}
    _ => return Err(FetchError::IpLiteralHost),
}
// 2. Keep the filtering resolver for names, so the address that is vetted is the one dialled.

// Leave alpn_protocols empty and let the builder set them:
let https = hyper_rustls::HttpsConnectorBuilder::new()
    .with_tls_config(tls_without_alpn)
    .https_only()
    .enable_http1()
    .build();
```

## NOTES
- Test the filter with IP-literal URLs in every form you accept (IPv4, bracketed IPv6), not only with names that resolve to blocked addresses.
- Redirects are a second way round a URL check; refuse them or re-validate each hop.
