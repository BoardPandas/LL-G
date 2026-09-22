---
tech: architecture
tags: [race-condition, ordering, dispatch, handoff, redis, websocket, testing, deterministic-test, authentication]
severity: high
---
# Persist what the receiver needs before dispatching to it

## PROBLEM

A dispatcher writes a command to a fast receiver (WebSocket push, queue publish,
webhook POST) and *then* stores the state the receiver must read back to
authenticate or correlate that command. The receiver acts on the command in
milliseconds and calls back before the write lands, so it is handed a 404 /
"not found" for state the dispatcher is about to create.

This is an intermittent failure that always succeeds on retry, which is why it
survives review and gets misfiled as "flaky network" or "the agent needs a
restart". The dispatcher's own logs look correct -- they just show the two
events in the order the code wrote them.

It is made worse by the near-universal habit of treating the persistence as
best-effort ("non-critical, log and continue"). If the consumer cannot function
without that state, a failed write is not non-critical: continuing merely
converts an instant failure into one that costs the caller the full connect
timeout before it reports something misleading.

Observed in SupportForge #298: `connect_agent` pushed `command_launch_console`
over the agent's WebSocket and afterwards wrote the `tech_launch:` /
`tech_request:` Redis handoff. The agent called `POST /v1/technician/auth-remote`
inside that window and received `404 Launch request not found or expired`; a
manual retry connected fine.

## WRONG

```ts
// Dispatch, then persist. The receiver wins the race.
const pushed = await pushLaunchCommand(agentId, requestId, email, mspId);

try {
  const redis = await getRedis();
  if (redis) {
    await redis.set(`tech_launch:${agentId}`, payload, { EX: 300 });
    await redis.set(`tech_request:${requestId}`, agentId, { EX: 300 });
  }
} catch (err) {
  // "Non-critical" -- but the consumer cannot authenticate without this.
  console.warn('failed to store launch state in Redis:', err);
}

await waitForAgentSession({ requestId, timeoutMs: 45_000 }); // times out
```

A test written against this passes, because the test's fake transport returns
immediately and nobody calls back.

## RIGHT

```ts
// 1. Persist first. Payloads first, the INDEX the consumer looks up LAST, so a
//    half-written handoff is unreachable rather than mismatched.
const handoff = await persistLaunchHandoff(db, { agentId, mspId, requestId, ... });
//   inside: set(`tech_launch:${mspId}:${deviceId}`, payload)
//           set(`tech_launch:${agentId}`,           payload)   // alias contract
//           set(`tech_request:${requestId}`,        index)     // consumers start here
//   on any failure: delete what landed, return { ok: false }

// 2. A failed persist is a failed dispatch, not a warning.
if (!handoff.ok) {
  await endSession(sessionId);
  return error('Could not store the handoff. No launch was sent.');
}

// 3. Only now dispatch.
const pushed = await pushLaunchCommand(agentId, requestId, email, mspId);
```

Deterministic regression -- make the dispatch fake *be* the receiver, so the
callback happens synchronously at the exact instant the command lands:

```ts
// No sleeps, no fake timers. Fails 404 against the old ordering.
(deliverToDevice as jest.Mock).mockImplementation(async (_target, message) => {
  seen.response = await request(app)          // the REAL consumer route
    .post('/v1/technician/auth-remote')
    .send({ requestId: message.requestId, agentId: AGENT_ID });
  return 'websocket';
});

await connectAgent();
expect(seen.response.status).toBe(200);       // 404 before the fix
```

Run it for every delivery path (direct socket and relayed), since only the
dispatch primitive differs and the race is identical in both.

## NOTES

- **Write the lookup key last.** Every consumer here started at
  `tech_request:<id>` and treated a miss as "expired". Ordering the index write
  last turns a partially written handoff into a retryable miss rather than a
  403 "request ID mismatch" that looks like an attack.
- **Clean up the handoff when the dispatcher gives up.** Otherwise a late
  receiver authenticates into a session nobody is attached to.
- **Ownership-check every delete.** Where two launches share a key (an alias
  keyed by device rather than by request), blind deletion on consumption
  destroys the other launch's state. Compare the stored request id first.
- The same shape appears wherever a fast consumer reads state the producer
  writes: enqueue-then-insert-row, webhook-then-store-nonce,
  redirect-then-save-oauth-state.
- Related: `attach-websockets-is-per-process-not-per-listener` in kb/nodejs --
  also a case where the dispatch primitive's real behaviour differed from what
  the calling code assumed.
