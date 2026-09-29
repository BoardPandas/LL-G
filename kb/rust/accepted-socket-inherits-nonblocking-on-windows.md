---
tech: rust
tags: [windows, tcp, tcplistener, nonblocking, wouldblock, wsaewouldblock, tests, mock-server, flaky]
severity: high
---
# A socket accepted from a non-blocking TcpListener is non-blocking on Windows

## PROBLEM
On Windows, a `TcpStream` returned by `accept()` on a listener set with `set_nonblocking(true)` inherits non-blocking mode. On Linux and macOS the accepted socket is blocking regardless. A test mock server that makes its listener non-blocking (so the accept loop can time out) and then reads the request with `read_line` fails at random, on Windows only, with `Os { code: 10035, kind: WouldBlock }` (WSAEWOULDBLOCK) whenever the read runs before the client's bytes arrive. `set_read_timeout` does not help: a non-blocking socket ignores it and returns `WouldBlock` immediately. Ubuntu and macOS CI stay green, so it looks like an ordinary flaky test.

## WRONG
```rust
let listener = TcpListener::bind("127.0.0.1:0")?;
listener.set_nonblocking(true)?; // so accept() can time out
let (socket, _) = loop {
    match listener.accept() {
        Ok(c) => break c,
        Err(e) if e.kind() == ErrorKind::WouldBlock => sleep(Duration::from_millis(5)),
        Err(e) => panic!("{e}"),
    }
};
socket.set_read_timeout(Some(Duration::from_secs(5)))?; // ignored: still non-blocking on Windows
BufReader::new(socket.try_clone()?).read_line(&mut line)?; // WouldBlock at random
```

## RIGHT
```rust
let (socket, _) = /* same non-blocking accept loop */;
socket.set_nonblocking(false)?; // accepted sockets inherit the listener's mode on Windows
socket.set_read_timeout(Some(Duration::from_secs(5)))?; // now actually bounds the read
BufReader::new(socket.try_clone()?).read_line(&mut line)?;
```

## NOTES
Seen in Hark's Gemini Files mock server (`crates/hark-stt/src/meeting_gemini.rs`): two tests failed only on the Windows runner, intermittently. The one-line fix held for 20 consecutive local runs and a green Windows CI (Hark 0.57.5, commit cc37f47). Applies to any accept loop that uses a non-blocking listener, not just tests.
