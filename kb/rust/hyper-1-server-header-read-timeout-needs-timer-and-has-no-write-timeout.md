---
tech: rust
tags: [hyper, http1, server, header-read-timeout, timer, panic, write-timeout, slowloris, stalled-client]
severity: medium
---
# hyper 1 server: header_read_timeout panics unless a timer is set, and the HTTP/1 server has no write timeout

## PROBLEM
Two gaps when serving connections with hyper 1's `http1::Builder` directly:

1. `header_read_timeout` needs a timer. Setting the timeout without also giving the builder a timer **panics**.
2. There is **no write timeout**. A client that sends a request and then stops reading the response holds its connection, and the task serving it, for as long as it likes. The header-read timeout does not cover this; it ends once the headers have arrived.

The second one is invisible in tests, where every client reads its response.

## WRONG
```rust
let mut http = hyper::server::conn::http1::Builder::new();
http.header_read_timeout(Duration::from_secs(10));     // no timer: panics
http.serve_connection(TokioIo::new(stream), service).await?;
// A client that never reads keeps this future alive indefinitely.
```

## RIGHT
```rust
let mut http = hyper::server::conn::http1::Builder::new();
http.timer(hyper_util::rt::TokioTimer::new());         // required by header_read_timeout
http.header_read_timeout(Duration::from_secs(10));

// Wrap the I/O so that a read or write making no progress for a deadline ends the connection.
let io = StallDeadline::new(stream, Duration::from_secs(30));
http.serve_connection(TokioIo::new(io), service).await?;
```

## NOTES
- `StallDeadline` stands for your own `AsyncRead + AsyncWrite` wrapper: it fails a read or write that has made no progress within the deadline. hyper does not provide it.
- Test with a client that sends a request for a large response and then stops reading; assert the server closes the connection.
- Related: `a-streaming-server-that-stalls-must-not-be-reported-as-a-network-timeout.md` on this shelf, for the client side of a stalled stream.
