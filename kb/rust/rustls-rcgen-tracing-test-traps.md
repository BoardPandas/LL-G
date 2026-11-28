---
tech: rust
tags: [rustls, rcgen, ring, tls, client-hello, signature-algorithms, session-resumption, certificate-rotation, tracing, cargo-test, log-capture]
severity: medium
---
# TLS and log-capture test traps: rustls ClientHello checks, rcgen RSA on ring, session resumption hiding a rotated certificate, tracing's callsite cache

## PROBLEM
Four facts that each produce a test failing, or passing, for the wrong reason:

1. **rustls refuses a ClientHello without `signature_algorithms` before it checks the protocol version.** A test that sends a hand-built old-version ClientHello to prove "TLS 1.0/1.1 is refused" is refused for the missing extension instead, so it proves nothing about versions.
2. **rcgen on the ring backend cannot generate RSA keys.** A test that needs an RSA certificate cannot ask rcgen to make the key.
3. **With session resumption on, clients resuming a session do not see a rotated certificate for up to a day.** A resumed handshake does not present the certificate again. A test (or a live check) that reloads the certificate and reconnects with a resuming client still sees the old one.
4. **tracing's callsite cache can disable scoped log capture under `cargo test`.** Whether a callsite is enabled is cached the first time it is hit. If that happens on a thread with no subscriber, a later test that installs a scoped subscriber to capture logs gets nothing from that callsite, depending on test order.

## WRONG
```rust
// 3. Reconnects with the same client config: resumes, never sees the new certificate.
reload_certificate(&server);
let again = connect(&client_config).await;
assert_eq!(peer_cert(&again), new_cert);          // fails

// 4. Scoped capture only; another test already hit the callsite with no subscriber.
let _guard = tracing::subscriber::set_default(capturing_subscriber);
do_work();
assert!(captured.contains("expected line"));      // flaky across the suite
```

## RIGHT
```rust
// 1. Send a ClientHello that is complete apart from the version under test
//    (include signature_algorithms), so the version check is what refuses it.
// 2. Generate the RSA key with another tool or backend and give rcgen the existing key.
// 3. Use a fresh client (no session cache / resumption disabled) to observe a rotated
//    certificate; account for resuming clients when planning a rotation.
// 4. In test support, install a global no-op subscriber once, before any test logs:
static INIT: std::sync::Once = std::sync::Once::new();
INIT.call_once(|| { let _ = tracing::subscriber::set_global_default(tracing::subscriber::NoSubscriber::default()); });
```

## NOTES
- For item 4, the global subscriber only has to exist; scoped subscribers installed by individual tests still take precedence on their threads.
