---
tech: rust
tags: [reqwest, multipart, http, error-handling, retry, timeout, blocking]
severity: high
---
# reqwest multipart streams the body and masks connect/timeout errors as body errors

## PROBLEM
With reqwest's `multipart` feature (blocking or async), the multipart body is
streamed through a channel to reqwest's internal runtime. If the connection
fails (dead DNS, unreachable host, connect timeout), the failure surfaces on
the body-sender side as an opaque error — Display: "request or response body
error … send failed because receiver is gone" — with `is_connect()` and
`is_timeout()` both returning `false` and no usable `io::Error` in the source
chain. Any error taxonomy or retry policy keyed on `is_connect()`/`is_timeout()`
silently misclassifies every transport failure on multipart requests. Small
text-only forms may still classify correctly, which makes the bug intermittent
and data-dependent (it appears once a bytes/file part is attached).

## WRONG
```rust
// reqwest = { version = "0.13", features = ["blocking", "multipart", ...] }
let form = reqwest::blocking::multipart::Form::new()
    .part("file", Part::bytes(wav).file_name("clip.wav").mime_str("audio/wav")?)
    .text("model", "whisper-1");
let err = client.post(url).multipart(form).send().unwrap_err();
// err.is_connect() == false, err.is_timeout() == false, even for a dead host.
// Retry logic that only retries on timeout/connect never fires.
```

## RIGHT
```rust
// Drop the "multipart" feature. Hand-assemble the body into a buffered Vec<u8>
// and set the boundary header yourself; buffered bodies classify correctly.
let boundary = "my-boundary-7f3a"; // ensure it doesn't occur in the payload
let mut body = Vec::new();
body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
body.extend_from_slice(b"Content-Disposition: form-data; name=\"model\"\r\n\r\nwhisper-1\r\n");
body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
body.extend_from_slice(b"Content-Disposition: form-data; name=\"file\"; filename=\"clip.wav\"\r\n");
body.extend_from_slice(b"Content-Type: audio/wav\r\n\r\n");
body.extend_from_slice(&wav);
body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

let err = client.post(url)
    .header(CONTENT_TYPE, format!("multipart/form-data; boundary={boundary}"))
    .body(body)
    .send()
    .unwrap_err();
// Now: dead DNS -> is_connect()==true in ms; unroutable IP -> is_timeout()==true
// at the connect bound. Bonus: body assembly becomes pure and unit-testable.
```

## NOTES
Verified 2026-07-15 on reqwest 0.13.1 (blocking, rustls) in Hark's STT spike
(crates/hark-stt). A connect-stage timeout has BOTH `is_timeout()` and
`is_connect()` true on buffered bodies — report the connect bound, not the
total request timeout, in that case. Related: reqwest 0.13 renamed the TLS
features (see reqwest-013-tls-feature-rename.md).
