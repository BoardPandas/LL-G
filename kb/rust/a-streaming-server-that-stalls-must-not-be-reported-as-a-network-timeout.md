---
tech: rust
tags: [websocket, streaming, retry, backoff, timeout, gemini-live]
severity: high
---
# A streaming server that stalls must not be reported as a network Timeout

## PROBLEM
A streaming session where the server accepted the input and then never finished, reported as the same `Timeout` a dead network produces, feeds every network-recovery path at once.
The read loop only sees "no frame within N ms", so the natural error is a timeout. But retry, resend-after-recovery and slow-link backoff all key off "timeout = network". Against a speech API that sent partial transcripts and then went silent, the identical retry stalled again 85% of the time (1,515 retries over three weeks), each attempt cost the full wait, the held chunk stalled again on resend, and stalls tripped a "slow connection" pause on a healthy link. A live transcript fell minutes behind and lost 1,462 lines.

## WRONG
```rust
let frame = tokio::time::timeout(per_frame, socket.next()).await
    .map_err(|_| SttError::Timeout { provider, configured_ms: per_frame_ms })?;
// downstream: Timeout => retry once, hold for resend, count toward backoff
```

## RIGHT
```rust
// After the input is fully sent and the turn closed, silence is the server's doing.
let frame = tokio::time::timeout(per_frame, socket.next()).await
    .map_err(|_| SttError::Stalled { provider, waited_ms: per_frame_ms })?;

fn should_retry(e: &SttError) -> bool {
    matches!(e, SttError::Timeout { .. }) // Stalled: no retry
}
// Failure class: Stalled => Provider (not retryable, not held, no backoff);
// route it to a fallback engine instead.
```

## NOTES
- Log what the session saw at the timeout (frames, interims, finals). Interims > 0 with 0 finals means the server is alive and stalling, not the network.
- Keep real transport timeouts (connect, send) as `Timeout`; only the post-input finalise wait becomes `Stalled`.
- Related: websocket-binary-frames-not-text (a different reason a Live session times out).
