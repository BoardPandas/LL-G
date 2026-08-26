---
tech: architecture
tags: [relay, protocol-evolution, backward-compatibility, addressing, envelope, rollout, one-to-many]
severity: medium
---
# Turning a 1:1 relay into 1:N: tag on the server, broadcast when unaddressed, and no client has to change

## PROBLEM

A relay that forwards opaque payloads between exactly two parties eventually has to serve several on one side. The moment it does, it needs an address: with one counterpart, "send it to the other one" is unambiguous; with three, a reply has to name its recipient.

The obvious implementation is a protocol version bump. Add a peer id to the message schema, ship it to both ends, and coordinate the release. That is a flag day, and for a relay between a fleet of endpoint agents and a fleet of clients, a flag day means every mismatched pair is broken until both sides update. Agents update on their own schedule; some are offline for weeks.

There is a shape that avoids it entirely, and it turns on two asymmetries most people do not notice they have.

**The relay already knows who sent a frame.** It arrived on a specific socket. So the sender never has to say who it is: the relay can stamp the address on the way through. That removes one whole side from the migration, because the many-side clients need no change at all, not even to be aware ids exist.

**An unaddressed frame has a safe default.** Broadcast it. With one counterpart, broadcasting to all counterparts is byte-for-byte the delivery that happened before, so an old peer on the one-side keeps working against a new relay without knowing anything changed.

Together those give compatibility in both directions from a single deployable change.

## WRONG

```
Flag day: add `peer` to the schema, update relay + agent + client, deploy together.
An old agent against a new relay: its replies name nobody and are dropped.
A new agent against an old relay: its `peer` field is forwarded verbatim and
ignored, which happens to work, but nothing guarantees it and nobody checked.
Every not-yet-updated endpoint is broken in the meantime.
```

```ts
// Or: make the many-side clients send their own id, which they have to be
// told, which means a handshake, which means a version negotiation.
socket.send(JSON.stringify({ ...frame, peer: myAssignedId }));   // now the client must change too
```

## RIGHT

```ts
// The relay mints an id per socket on the many side.
const peerId = mintPeerId();
pairing.technicians.set(peerId, { socket, id: peerId });

socket.on('message', (raw) => {
  if (audience === 'technician') {
    // Stamped on the way through. The sender never knew its own id.
    endpoint.socket.send(tagWithPeer(raw.toString(), peerId));
    return;
  }
  // From the one side: to the peer it names, or to all of them if it names
  // nobody. The broadcast is the compatibility path: with a single counterpart
  // it is exactly the old delivery.
  const target = addressedPeer(raw.toString());
  const recipients = target
    ? [current.technicians.get(target)].filter(Boolean)
    : [...current.technicians.values()];
  for (const r of recipients) r.socket.send(raw.toString());
});
```

```go
// The one-side peer echoes the id it was given, and treats absent as a real key.
type signalMessage struct {
    Type string `json:"type"`
    // ...
    Peer string `json:"peer,omitempty"`
}

// An empty peer id is not an error. It is what an older relay produces, and it
// behaves exactly as the single unnamed counterpart that existed before.
v, err := viewers.ensure(msg.Peer)
```

Deploy in any order:

| relay | one-side peer | result |
|---|---|---|
| old | old | unchanged |
| new | old | old peer answers without an id, relay broadcasts, one counterpart, identical delivery |
| old | new | old relay forwards the extra field verbatim, one counterpart ignores it |
| new | new | addressed routing, N counterparts |

## NOTES

- This costs the relay its "never inspects the payload" property, and that is worth stating in the code rather than discovering later. Reading and writing one envelope field is not the same as parsing the payload, and the distinction is worth writing down: it should still never touch the SDP, the ciphertext, or whatever the payload actually is.
- Pass through anything you cannot parse, rather than dropping it. The relay is not the authority on the payload format and never was; a frame that is not JSON should still be delivered.
- The empty/absent address must be a **valid key**, not an error branch. Treating it as "the one unnamed peer" is what makes the old-peer path exercise the same code as the new one, instead of a compatibility branch that rots.
- Make teardown asymmetric at the same time. One side is the session; the other side is a participant. Leaving the shared teardown in place means one of N participants disconnecting still ends the whole thing.
- Do the same reasoning for the reverse direction before assuming the many-side needs no change: it holds here because those clients only ever reply to frames addressed to them, so the address round-trips through the relay rather than through them.
