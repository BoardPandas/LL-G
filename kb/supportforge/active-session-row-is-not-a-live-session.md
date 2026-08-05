---
tech: supportforge
tags: [technician-console, sessions, websockets, redis, postgres, deploy, liveness, restart]
severity: high
---
# A technician session row marked 'active' is not evidence the session is live

## PROBLEM

A technician session exists only while some API process holds the agent's
WebSocket in memory (`activeSessions`). The `technician_sessions` row is a
record *about* that socket, not the thing itself.

Nothing closes the row when the holding process dies. `endSession` runs on a
clean socket close, and a pod restart is not one — so every deploy leaves rows
that claim `status = 'active'` indefinitely. A single production API had **55**
of them.

Those rows are not inert. Both the launch flow and the agent's own auth resolve
"the newest active session for this agent" straight from the table, so a zombie
row gets handed to the browser as a live session id. The console opens, sends
its dashboard auth, finds nothing holding that id, and reports **"Session not
found"** — on every machine, for every technician, until something happens to
replace the row.

The symptom surfaces in the browser, three hops from the cause, and looks like a
WebSocket or auth problem. It is neither.

The same trap has a second floor. The obvious fix is to check a Redis ownership
record (`tech_owner:<sessionId>` = instance id) instead of the DB row — but that
key has a 4-hour TTL and **outlives the process that wrote it**. After a restart
a dead session still looks owned, so the check passes and the zombie sails
through. An ownership record proves someone claimed the session, not that anyone
still holds it.

## WRONG

```typescript
// launch-status: "has the agent connected yet?"
const { rows } = await db.query(
  `SELECT id FROM technician_sessions
   WHERE agent_id = $1 AND msp_id = $2 AND status = 'active'
   ORDER BY started_at DESC LIMIT 1`,
  [agentId, mspId]
);

if (rows.length > 0) {
  // A row survives its process. This hands the browser a dead session id,
  // and the console it opens can only answer "Session not found".
  return res.json({ status: 'active', sessionId: rows[0].id });
}
```

```typescript
// Second-order wrong: an owner record outlives its writer.
const owner = await redis.get(`tech_owner:${sessionId}`);
if (owner) return { live: true };   // ← still true for a pod that died hours ago
```

## RIGHT

```typescript
// Each process announces itself on a short TTL and retracts on shutdown.
const INSTANCE_TTL_SECONDS = 90;
const INSTANCE_REFRESH_MS = 30_000;

await redis.set(`tech_instance:${INSTANCE_ID}`, String(Date.now()),
                { EX: INSTANCE_TTL_SECONDS });

// Liveness = someone claimed it AND that someone is still running.
// 'unknown' is deliberately distinct: never destroy state on a failed lookup.
async function readSessionLiveness(sessionId) {
  const redis = await getRedis();
  if (!redis) return 'unknown';

  const owner = await redis.get(`tech_owner:${sessionId}`);
  if (!owner) return 'orphaned';

  return (await redis.exists(`tech_instance:${owner}`)) ? 'held' : 'orphaned';
}
```

```typescript
// Read side: corroborate the row before acting on it.
if (rows.length > 0) {
  const id = rows[0].id;
  const held = activeSessions.has(id) || (await readSessionLiveness(id)) === 'held';
  if (held) return res.json({ status: 'active', sessionId: id });
  // Otherwise keep polling — the agent's own auth will name a real session.
}
```

```sql
-- Boot side: reconcile before listen(), so no agent can attach mid-sweep and
-- have its own session reaped out from under it.
-- Anything idle past the cutoff is dead by construction: a session cannot
-- outlive its 30-minute inactivity timeout, and owner records expire in 4h.
UPDATE technician_sessions SET status = 'ended', ended_at = NOW()
WHERE status = 'active'
  AND COALESCE(last_activity_at, started_at) < NOW() - INTERVAL '24 hours';
-- Rows newer than that get the per-row liveness check above.
```

## NOTES

- **Ordering is load-bearing.** The boot sweep must complete *before* the server
  starts accepting connections. Run it after the schema check and before
  `listen()`. Sweeping afterwards races an agent that connects during the sweep
  and ends the session it just created.
- **Three-state liveness, not a boolean.** `unknown` (Redis unreachable) must be
  distinct from `orphaned`. A caller that would destroy state on a negative
  answer must not act on a lookup failure — one stale row costs nothing, ending
  a session a technician is actively using costs a callback.
- **Multi-instance safety comes free** from the heartbeat: a peer's healthy
  sessions have a live `tech_instance` key, so one instance restarting never
  reaps another's work. Age-based heuristics alone cannot make that distinction.
- **Retract on shutdown** (`DEL tech_instance:<id>`) before closing Redis, so the
  replacement process can reap immediately instead of waiting out the TTL.
- Do not confuse this with
  [online-flag-vs-hung-executor.md](online-flag-vs-hung-executor.md), which
  produces a similar-sounding *"Session not found or has ended"* from a live
  agent whose executor is hung on a full disk. That one appears mid-session
  after a command or two; this one appears immediately, before any command runs,
  and clears only when a new session replaces the row.
- Verify with the boot log rather than the table:
  `[TechReaper] Ended N orphaned technician session(s) from a previous process`.
- Fixed in supportforge-platform v3.42.2.0 (commit `60ee9762`).
