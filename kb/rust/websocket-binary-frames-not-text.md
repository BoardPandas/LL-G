---
tech: rust
tags: [websocket, tokio-tungstenite, gemini, live-api, streaming, binary-frames, flow-control, timeout]
severity: high
---
# A WebSocket JSON API may send its frames as Binary, not Text

## PROBLEM

WebSocket has two payload frame types, and which one a server picks for JSON is
entirely its choice. Nothing in a JSON-over-WebSocket API's documentation
usually says which you will get, and the request/response examples are printed
as JSON either way, so the natural client matches `Message::Text` and drops
everything else.

If the server sends `Message::Binary`, that client sees an **empty
conversation**. Not an error -- silence. The connect succeeded, the handshake
succeeded, every send succeeded, and the read loop simply never matches
anything, so it blocks until its own timeout fires. The failure surfaces as
"request timed out after N ms" with no error frame, no status code, and no
indication that bytes were arriving the whole time.

Measured against Google's Gemini Live API (`gemini-3.5-transcribe-live`) with
`tokio-tungstenite` 0.30: `setupComplete`, every interim transcript, and the
final transcript all arrive as `Message::Binary` carrying UTF-8 JSON. A client
matching only `Message::Text` transcribes nothing, forever.

Two companion traps in the same protocol, each of which independently produces
the identical unexplained timeout:

1. **The documented turn terminator may not be the one that arrives.** Gemini
   Live ends a transcription turn with `serverContent.generationComplete`;
   `turnComplete` -- which the Live API reference documents -- never arrives at
   all. A loop breaking only on `turnComplete` collects the finished transcript
   and then times out *while discarding it*.

2. **A write-only send loop stalls the connection.** Server output starts
   arriving while the client is still uploading. A client that sends its whole
   payload without ever polling the read half lets that output back up; the
   server stops making progress and never acts on the end-of-stream signal that
   follows. Symptom: interims stream normally, then dead silence -- the server
   is still connected and still has your data, it just never finalises.

All three collapse into one symptom, which is why they are worth fixing
together. The multiplier is a read loop that silently ignores unrecognised
frames: with `_ => {}` as the catch-all there is no way to tell "wrong frame
type", "wrong terminator field" and "connection stalled" apart, and each one
looks exactly like the provider being slow.

## WRONG

```rust
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message;

// Send the whole payload, then read. Never reads while writing.
for chunk in payload.chunks(CHUNK) {
    socket.send(Message::Text(frame(chunk).to_string().into())).await?;
}
socket.send(Message::Text(end_of_stream().to_string().into())).await?;

loop {
    let frame = tokio::time::timeout(deadline, socket.next()).await??;
    let Some(frame) = frame else { break };
    match frame? {
        // Binary frames -- i.e. all of them -- fall into the catch-all and
        // vanish. So does any frame shape not anticipated here.
        Message::Text(body) => match parse(&body)? {
            Event::Final(text) => segments.push(text),
            Event::TurnComplete => break,   // never sent; generationComplete is
            _ => {}
        },
        _ => {}                             // <-- the entire conversation
    }
}
// Times out. No error, no status, no clue that JSON was arriving all along.
```

## RIGHT

```rust
/// Take the JSON body from whichever frame type carried it. Accept both:
/// nothing in the protocol promises a server will keep using one.
fn frame_json(frame: &Message) -> Option<String> {
    match frame {
        Message::Text(body) => Some(body.to_string()),
        Message::Binary(bytes) => String::from_utf8(bytes.to_vec()).ok(),
        _ => None,
    }
}

// Keep the receive side moving WHILE sending, or the connection stalls.
for chunk in payload.chunks(CHUNK) {
    socket.send(Message::Text(frame(chunk).to_string().into())).await?;
    drain_pending(&mut socket).await;   // bounded, zero-timeout reads
}
socket.send(Message::Text(end_of_stream().to_string().into())).await?;

let mut frames = 0u32;
loop {
    let frame = tokio::time::timeout(deadline, socket.next())
        .await
        .map_err(|_| {
            // A bare timeout cannot distinguish "never heard us" from "still
            // thinking". The counts can, and cost nothing until it fails.
            log::warn!("finalise timed out: {frames} frames seen, {} final",
                       segments.len());
            Error::Timeout
        })??;
    let Some(frame) = frame else { break };
    let frame = frame?;
    frames += 1;

    if let Some(body) = frame_json(&frame) {
        let v: serde_json::Value = serde_json::from_str(&body)?;
        // Accept BOTH terminators: the documented one and the observed one.
        if let Some(c) = v.get("serverContent") {
            for done in ["generationComplete", "turnComplete"] {
                if c.get(done).and_then(|t| t.as_bool()).unwrap_or(false) {
                    return Ok(join(&segments));
                }
            }
        }
        // Never swallow silently: keys only, since a frame may carry user text.
        log::debug!("unhandled frame: {:?}", top_level_keys(&v));
        continue;
    }
    if matches!(frame, Message::Close(_)) { break; }
}
```

## NOTES

**Diagnose with a probe, not by inference.** All three bugs above were found in
minutes by a throwaway example that connects, dumps every frame raw with
timings, and stops -- and none of them were findable from the adapter's own
behaviour, which reported only a timeout. Write the probe *before* shipping a
WebSocket client, not after. Commit it: the protocol is the part the docs get
wrong, and the next person needs the same tool.

**Never print the socket URL.** Several WebSocket APIs (Gemini Live among them)
take the API key as a **query parameter**, which makes the URL itself a secret.
`tokio-tungstenite`'s error `Display` echoes the URL it failed on, so the
obvious `format!("connect failed: {e}")` leaks the key into logs. Scrub `key=`
out of every error string before it can be logged.

**Waiting for the setup acknowledgement is required but is not this bug.** The
Live API spec says clients must wait for `BidiGenerateContentSetupComplete`
before sending anything else, and that is worth implementing. It was also the
first hypothesis here and it was wrong -- the ack had been arriving all along,
in a Binary frame nobody was reading. When a protocol client sees nothing,
suspect the frame type before the handshake ordering.

**Test doubles will not catch any of this.** A fake session driven through the
client's own trait passes every one of these bugs, because the fake speaks
whatever the client already expects. Only a real connection distinguishes
"parses correctly" from "parses what the server actually sends".

Related: `blocking-io-on-tokio.md` (keep any runtime introduced by a streaming
adapter scoped to that adapter), `reqwest-multipart-masks-transport-errors.md`
(same family of defect: a transport detail quietly destroying an error
taxonomy).
