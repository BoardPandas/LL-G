---
tech: northflank
tags: [load-balancer, udp, turn, stun, webrtc, source-nat, relay, coturn]
severity: high
---
# A UDP load balancer source-NATs, so STUN/TURN behind one is silently useless

## PROBLEM

Northflank exposes public UDP through an L4 load balancer, which provisions
cleanly, holds a static IP, and forwards traffic correctly. A coturn container
behind one starts, passes health checks, and answers STUN Binding Requests.
Everything reads as working.

It is not. The load balancer rewrites the source address, so the relay sees
every client as the balancer's internal RFC1918 address instead of the client's
real one. That breaks the entire point of STUN/TURN:

* STUN exists to tell a client its **public reflexive address**. Reporting a
  private one yields ICE candidates no peer can route to.
* A correctly hardened relay denies `10.0.0.0/8` as an allowed peer range (to
  stop an open relay becoming a proxy into your own private network), so it
  then refuses to relay to exactly the addresses the balancer makes it see. The
  security control is right, which is why nothing connects.
* Per-client quotas (`user-quota`, rate limits) collapse, because every client
  shares one apparent source address.

No relay-side setting fixes it. The client's real address never arrives in the
container, so there is nothing to configure. The failure surfaces far away —
as "NAT traversal doesn't work" — long after the load balancer has been paid
for and built on.

## WRONG

```bash
# Deploy coturn behind a Northflank UDP load balancer, confirm the service is
# healthy and the balancer says "created", and treat that as working.
#
#   lb state:      created, endpoint 34.86.83.57
#   service state: COMPLETED, TCP health check on 3478 passing
#   coturn log:    "Relay ports initialization done"
#
# All green. None of it tests whether the relay can see a client.
```

## RIGHT

```js
// Send a real STUN Binding Request from OUTSIDE and compare the reflexive
// address it reports against a known-good public STUN server. Two minutes of
// work; it is the only check that distinguishes "answers" from "answers
// usefully".
const dgram = require('node:dgram'), crypto = require('node:crypto');
const txid = crypto.randomBytes(12);
const req = Buffer.alloc(20);
req.writeUInt16BE(0x0001, 0);            // Binding Request
req.writeUInt32BE(0x2112a442, 4);        // magic cookie
txid.copy(req, 8);
// ...send, then read XOR-MAPPED-ADDRESS (attr 0x0020) from the 0x0101 response:
//   xport = msg.readUInt16BE(off + 6) ^ 0x2112
//   xip   = msg.readUInt32BE(off + 8) ^ 0x2112a442

// Against the relay behind the balancer:
//   OK — it saw us as 10.28.111.85:57588      <-- private: BROKEN
// Against stun.cloudflare.com:3478 from the same host:
//   OK — it saw us as 64.99.149.3:58673       <-- the real public address
```

## NOTES

Run the control probe too. "No response" from your relay and "outbound UDP is
blocked from this host" look identical, and only the second is your problem.

The fix is not a setting, it is a host: the relay needs somewhere it can hold a
public IP directly (a VM), or use a managed TURN provider that owns its own
addressing. Note that a managed relay carries session media and becomes a
subprocessor, which may be a compliance decision rather than a technical one.

Two adjacent Northflank facts found while chasing this, both of which look like
the same bug and are not:

* A load-balancer port entry must target a port **declared on the backing
  service**. Pointing at an undeclared port passes payload validation, moves to
  `staging`, then settles in `error` with no detail exposed by the API.
* Port entry ids must match `^port-\d+$`, and `description` is capped at 200
  characters — both are 400s at create time, not provisioning failures.

See also `doppler-no-auto-sync-env-full-replace.md`: nothing pushes Doppler to
Northflank, so relay credentials added in one place never reach the container.
