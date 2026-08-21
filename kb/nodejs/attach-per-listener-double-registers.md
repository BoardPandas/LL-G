---
tech: nodejs
tags: [websocket, ws, pubsub, cluster-bus, module-state, mtls, duplicate-delivery, idempotency, silent-duplication]
severity: high
---
# Attaching shared WebSocket wiring to two HTTP listeners double-registers every process-wide subscriber

## PROBLEM

A function named `attachWebSocketServers(httpServer)` reads as per-listener setup. Usually most
of what it does is per-*process*: constructing `WebSocketServer({noServer: true})` instances,
subscribing to a pub/sub or cluster bus, and starting heartbeat/sweep intervals — all against
module-level state shared by every caller.

Call it once per HTTP listener and everything except the `upgrade` handler is registered N times.
The delivery path is the dangerous part: if a bus subscriber looks a connection up in a
module-level map and writes to it, then N subscribers fire per publish and the same socket is
written N times. The remote peer receives every message N times.

Nothing errors. The sockets are healthy, the payloads are valid, and each duplicate is
individually correct — so this is invisible in metrics and looks like a bug in whatever consumes
the messages.

Two listeners is the common shape: a plaintext server plus an mTLS/TLS one, where the second is
built conditionally from config so it only manifests where that flag is on (typically production).

Seen live: a desktop-agent command channel where every instruction was delivered twice. Two
consent prompts per session, two "start the remote session host" pushes — so two host processes
raced for one session, the loser spent the session's single-use credential and was refused with
WebSocket close 4401, and the session died. Every remote command executed twice on the endpoint
as a side effect. The investigation started on the agent, which was blameless.

**The tell is in the boot log**: one-time startup lines printed once per registration. If
`"WebSocket server started on /x"` appears twice in a single process's startup, you have this.

## WRONG

```typescript
// startup/websocket-core.ts
export async function attachWebSocketServers(httpServer: HttpServer) {
  const commandWss = new WebSocketServer({ noServer: true });
  const heartbeat = setupAgentCommandWebSocket(commandWss);
  // ^ subscribes to AGENT_CMD_CHANNEL and delivers into a module-level
  //   `activeSessions` map. Called twice => two subscribers => every
  //   relayed message written to the agent's one socket twice.

  httpServer.on('upgrade', (req, socket, head) => { /* route by pathname */ });
  console.log('[AgentCommandWS] WebSocket server started on /agent/command');
  return { heartbeat };
}

// ws-server.ts
await attachWebSocketServers(httpServer);                  // plaintext
const mtlsServer = await startMtlsListener(...);           // non-null in prod
if (mtlsServer) await attachWebSocketServers(mtlsServer);  // <-- doubles everything
```

## RIGHT

```typescript
// Split "once per process" from "once per listener".
let shared: Promise<SharedWebSocketServers> | null = null;

export async function attachWebSocketServers(httpServer: HttpServer) {
  // Memoize the PROMISE, so two concurrent callers cannot both start a setup
  // that is already running. Clear it on rejection, or a failed setup is
  // replayed to every later caller forever.
  const pending = (shared ??= createShared().catch((err) => { shared = null; throw err; }));
  const servers = await pending;
  attachUpgradeHandler(httpServer, servers);   // the one genuinely per-listener thing
  return servers.attached;
}

async function createShared(): Promise<SharedWebSocketServers> {
  const commandWss = new WebSocketServer({ noServer: true });
  const heartbeat = setupAgentCommandWebSocket(commandWss);   // subscribes ONCE
  return { commandWss, /* ... */, attached: { heartbeat } };
}
```

```typescript
// Guard it. Assert BOTH halves: registered once, but still upgrading on every
// listener -- a "fix" that registers once and attaches the upgrade handler
// once leaves the mTLS listener unable to accept connections at all.
it('registers each handler once however many listeners attach', async () => {
  await attachWebSocketServers(fakeServer());
  await attachWebSocketServers(fakeServer());
  expect(setupAgentCommandWebSocket).toHaveBeenCalledTimes(1);
});

it('still handles upgrades on every listener it is given', async () => {
  const a = fakeServer(), b = fakeServer();
  await attachWebSocketServers(a.server);
  await attachWebSocketServers(b.server);
  expect(a.upgradeListeners).toBe(1);
  expect(b.upgradeListeners).toBe(1);
});
```

## NOTES

- **Symptom-first debugging rule:** when something on the far side of a channel "happened twice",
  count the server's registrations before suspecting the receiver. Grep a single process's startup
  log for one-time lines appearing more than once.
- The extra intervals leak too — the second call's `setInterval` handles are returned to a caller
  that discards them, so shutdown clears only one set.
- Idempotency on the receiving end is worth adding regardless as defence in depth, but it is a
  second line: a short dedupe window keyed by whatever identifies the work (a session id) turns a
  redelivery into a no-op. Prefer a window over a permanent "already handled" flag when the work
  can legitimately recur later.
- The same shape appears wherever setup is written as "attach to a server" but performs global
  registration: Redis subscribers, `process.on` handlers, metrics collectors, cron registration.
  If a function both constructs per-connection objects and subscribes to something global, it can
  only be called once and its name should say so.
