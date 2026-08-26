---
tech: webrtc
tags: [signaling, relay, pairing, peer-eviction, session-teardown, multi-viewer, screen-share, silent-failure]
severity: high
---
# In a paired signaling relay, evicting a duplicate peer tears down the whole pairing, not just that peer

## PROBLEM

A signaling relay that pairs exactly two peers has an obvious-looking answer for a second connection on one side: replace the incumbent. Three-way signaling is not a thing, the newcomer is presumably a reconnect, and silently ignoring it would leave someone connected to a channel nobody reads. So the code closes the old socket and installs the new one.

That reasoning is right about everything except what `close()` does next.

The incumbent's socket has a `close` handler. That handler is the teardown path, and teardown for a *paired* relay closes the pairing, which closes **the other side too**. So the sequence is:

1. Technician B connects to a session Technician A is holding.
2. Relay closes A's socket with a "replaced" code.
3. A's close handler fires teardown.
4. Teardown closes the pairing, which closes the **endpoint's** socket.
5. The endpoint reads its signaling channel closing as a failed host and ends the session.

The net effect is the opposite of the intent. B does not take over: B joins a session that is being destroyed underneath them, A's picture dies with no explanation, and the session ends for everybody. The endpoint is the only party that gets a legible reason, and it is the wrong one.

This survives review because every individual piece is defensible, and it survives testing because the natural test asserts step 2 and stops there. A real suite here had a passing test named for the eviction, asserting the incumbent was closed with the replacement code and the newcomer relayed afterwards. It never connected the endpoint, so it never observed the collapse it was documenting.

## WRONG

```ts
// One peer per side. A second connection replaces the first.
const existing = pairing[audience];
if (existing) {
  existing.socket.close(CLOSE_REPLACED, 'replaced by a newer connection');
  //            ^ fires existing's close handler
  //              -> teardown()
  //                 -> closePairing()
  //                    -> closes pairing.agent too
  //                       -> endpoint ends the session
}
pairing[audience] = { socket, audience };
```

```ts
function closePairing(pairing, code, reason) {
  for (const peer of [pairing.technician, pairing.agent]) peer?.socket.close(code, reason);
  pairings.delete(pairing.sessionId);
}

const teardown = (why) => {
  const current = pairings.get(sessionId);
  if (!current || current[audience]?.socket !== socket) return;  // guard does not help the evicted peer
  closePairing(current, CLOSE_SESSION_ENDED, why);               // it IS still the installed socket at this point
};
```

## RIGHT

Two options. Pick by whether the transport can actually serve the newcomer.

**If it cannot yet: refuse the newcomer, never the incumbent.**

```ts
const existing = pairing[audience];
if (existing) {
  if (existing.socket.readyState === existing.socket.OPEN) {
    socket.close(CLOSE_SIDE_OCCUPIED, 'another peer is already connected to this session');
    return;   // the incumbent is untouched, so no teardown runs
  }
  // Already closing: a reconnect racing its own teardown, not a rival.
  existing.socket.close(CLOSE_REPLACED, 'replaced by a newer connection');
}
pairing[audience] = { socket, audience };
```

The refused socket's own close still fires teardown, and the existing guard (`current[audience]?.socket !== socket`) now returns early, because the newcomer was never installed. That guard is what makes refusal safe, and it is worth a test of its own.

**If it can: make teardown asymmetric.** One side is the session; the other side is a participant.

```ts
const teardown = (why) => {
  const current = pairings.get(sessionId);
  if (!current) return;

  if (audience === 'agent') {                       // the endpoint IS the session
    if (current.agent?.socket !== socket) return;
    closePairing(current, CLOSE_SESSION_ENDED, why);
    return;
  }
  if (current.technicians.get(peerId)?.socket !== socket) return;
  current.technicians.delete(peerId);               // a viewer takes only itself
};
```

## NOTES

- The tell during review: a close handler that reaches a *shared* structure. `socket.close()` is never local when its handler owns the pairing, and "replace" is the case where you invoke it on a peer that is still fully installed.
- Distinguish a rival from a reconnect by `readyState`. A socket that is already `CLOSING`/`CLOSED` is a client racing its own teardown and should be replaced; an `OPEN` one is a genuine second party and should be refused or joined.
- Check what your tests assert about eviction before changing it. A test named "a second connection replaces the first" is documenting the bug, and updating it is part of the fix rather than a sign you broke something.
- The same shape appears outside WebRTC: any two-party relay with per-socket teardown (terminal multiplexers, device-pairing brokers, collaborative-edit brokers) has this if teardown closes the pair.
- Related: single-use credentials make the "is it a reconnect?" question harder, because a legitimate reconnect cannot present the same credential twice. Decide whether reconnect is supported before deciding what to do with a duplicate.
