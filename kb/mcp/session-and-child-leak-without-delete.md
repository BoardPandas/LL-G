---
tech: mcp
tags: [streamable-http, session-lifecycle, stdio, child-process, memory-leak, oom, exit-137, graceful-shutdown]
severity: high
---
# A streamable-HTTP session and its stdio child live until the client sends DELETE

## PROBLEM

`StreamableHTTPServerTransport` has no session TTL. Tracing the SDK (v1.29.0), `onclose`
fires only from `close()`, and `close()` is reached only from `handleDeleteRequest` or an
explicit call. There is no timer, no eviction, and **a dropped SSE stream does not end the
session**. So a host that removes sessions in `transport.onclose` only ever removes the ones
whose client politely sent `DELETE`. Every client that just vanishes — tab closed, network
drop, token expiry, process killed — pins its session forever.

That is a slow leak for an in-process server and a much worse one for a `stdio` provider,
where each session owns a spawned child process. Those children are **outside the V8 heap**,
so they accumulate against the container's cgroup limit and the kernel OOM-kills the pod.

The diagnosis is what makes this expensive. The container dies with **exit 137 (SIGKILL) and
no V8 message** — no `FATAL ERROR: ... JavaScript heap out of memory`, no stack, nothing in
the application log. A Node heap exhaustion always prints that banner, so its *absence* is
the signal: this is the cgroup OOM killer reaping total RSS, not a JS heap leak. Heap
profiling and `--max-old-space-size` chase the wrong thing entirely.

CPU metrics actively mislead here: idle children burn almost no CPU while holding tens of MB
each, so the usage graph stays flat right up to the kill.

The cheapest confirmation is counting orphans at teardown. If a connector logs a shutdown
banner, a pod replacement prints one line per still-live child:

```
19:21:50  👋 Shutting down Doppler MCP Server...
19:21:50  👋 Shutting down Doppler MCP Server...   # two children, from sessions hours apart
```

Two banners means two sessions were still resident, only killed because the pod died.

## WRONG

```ts
// sessions.ts — entries are removed only when a transport closes
const sessions = new Map<string, BridgeSession>();
export const setSession = (id, s) => void sessions.set(id, s);
export const deleteSession = (id) => void sessions.delete(id);

// router.ts
transport.onclose = () => {
  if (transport.sessionId) deleteSession(transport.sessionId);
  void cleanup();               // kills the spawned child, revokes its token
};

// ...and nothing else ever calls close(). No TTL, no cap, no sweeper, no SIGTERM
// handler. A client that never sends DELETE leaks the session AND its child process.
```

## RIGHT

```ts
// Stamp activity, then evict on a timer. Closing the transport is what reaps the
// resources — onclose already kills the child and revokes its token.
interface BridgeSession { /* ... */ lastSeenAt: number }

export function touchSession(id: string): void {
  const s = sessions.get(id);
  if (s) s.lastSeenAt = Date.now();
}

export async function sweepIdleSessions(idleMs: number): Promise<number> {
  const cutoff = Date.now() - idleMs;
  const stale = [...sessions.entries()].filter(([, s]) => s.lastSeenAt < cutoff);
  for (const [id, s] of stale) {
    sessions.delete(id);                    // drop first: a transport that fails to fire
    try { await s.transport.close(); }      // onclose must not pin the session forever
    catch (err) { console.error("[sessions] close failed:", err); }
  }
  return stale.length;
}

// unref() so the interval never holds the loop open, and the caller MUST clear it first
// on shutdown — an interval outliving the drain fires against a half-torn-down map.
export function startSessionSweeper(intervalMs: number, idleMs: number): () => void {
  const h = setInterval(() => void sweepIdleSessions(idleMs).catch(console.error), intervalMs);
  h.unref();
  return () => clearInterval(h);
}
```

```ts
// Cap before spawning: a stdio session is a real process, so an initialize loop costs
// RSS the container cannot reclaim.
if (sessionCount() >= MAX_SESSIONS_TOTAL) return res.status(503).json(rpcError("At capacity"));
if (countSessionsForUser(uid) >= MAX_PER_USER) return res.status(429).json(rpcError("Too many sessions"));

// And drain on SIGTERM, or every deploy orphans children to the container runtime.
const shutdown = async () => {
  stopSweeper();                 // FIRST — see LL-G nodejs: timers outliving shutdown
  server.close();
  await closeAllSessions();      // closes transports -> reaps children
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
```

## NOTES

- **Touch semantics.** Stamp per *request*, not per open stream. A session holding one SSE
  stream with zero requests past the window is idle by any useful definition; the client
  recovers by reinitializing. Pick a generous window (30 min) so this is invisible in normal
  use, and know it is a user-visible behavior change: an idle connector now disconnects.
- **Clear the sweeper before draining.** See the Node.js HIGH entry *"job's one-shot kickoff
  timer outlives graceful shutdown"* — the same failure mode applies to any interval a
  shutdown path forgets to cancel.
- Companion to *"Process-global MCP server leaks across tenants if run in-process"*: that
  entry says spawn one child per session; this one says you must also reap them. Following
  the first without the second converts a correctness bug into an availability bug.
- **Correlated symptom.** A FastMCP-based child logging `received error listing roots` plus
  `McpError: MCP error -32001: Request timed out` exactly 60s after start (the SDK's default
  request timeout) means a *server→client* request had nowhere to go — such requests need an
  open SSE stream. If the proxy forwards with `.catch(() => {})`, that failure is invisible
  and the child's timeout is the only symptom. Log the send failure.
- Raising the memory plan only buys time proportional to the increase; it does not change
  the slope. Fix the reaping.
