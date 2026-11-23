---
tech: nodejs
tags: [websocket, resume, reconnect, deploy, drain, redis, railway, sigterm, single-use-token]
severity: high
---
# An in-memory WebSocket resume token dies with the deploy, the commonest drop of all

## PROBLEM
A relay gives each WebSocket client a single-use resume ticket so a dropped socket
can re-dial and reclaim its seat. The ticket is kept only in the issuing process's
memory. That handles network blips and proxy idle timeouts, and every test passes.

The most common cause of a dropped socket on a platform that deploys on every push
is the deploy itself. The draining process closes every socket (1012), the client
re-dials within ~100 ms, reaches the NEW instance, and that instance has never seen
the ticket -- so it refuses it (401/4401) and the session ends. The resume feature
works for everything except the event it fires for most often. Nothing errors on
the server; the client just logs "resumed" followed by "could not resume".

## WRONG
```ts
const seatsByTokenHash = new Map<string, Seat>();   // process memory only

export function resume(raw: WebSocket, token: string) {
  const seat = seatsByTokenHash.get(sha256(token));
  if (seat?.takeOver(raw)) return;
  raw.close(4401, 'unauthorized');                   // every resume after a deploy
}

async function drain() {
  for (const pairing of pairings.values()) closePairing(pairing, 1012, 'draining');
}
```

## RIGHT
```ts
async function drain() {
  draining = true;
  // BEFORE closing anything: the client re-dials the moment its socket closes.
  await redis.multi(seats.filter(s => s.holdable()).map(s =>
    ['SET', `handoff:${s.ticketHash}`, JSON.stringify(s.record()), 'EX', '60'])).exec();
  for (const pairing of pairings.values()) closePairing(pairing, 1012, 'draining');
}

async function resume(raw: WebSocket, token: string) {
  if (takeOverLocal(raw, token)) return;
  const record = await redis.getDel(`handoff:${sha256(token)}`);   // single use across instances
  const identity = record && await reauthorizeFromDatabase(parse(record)); // Redis names, DB authorizes
  if (!identity) return raw.close(4401, 'unauthorized');
  seat(raw, identity, { peerId: record.peerId });                  // same id peers address it by
}
```

## NOTES
- Key by the ticket's hash, never the ticket. TTL just above the client's resume
  budget (60 s for a 20 s budget) so the record outlives nothing it was for.
- Re-authorize against the database rather than trusting the stored record, but
  skip admission-only checks such as a launch credential's expiry: those credentials
  expire in minutes, so admission checks refuse every seat older than that.
- Carry whatever per-pairing state peers rely on (stable peer ids, capability
  announcements) or the restored session silently loses features.
- Peers that cannot resume (older clients) still lose their socket; tell their
  counterparts the peer is being replaced instead of dropping them too.
- Needs a real drain window: Railway's draining/overlap seconds default to 0 (see
  railway shelf). Write the handoff before the first close, bounded by a deadline,
  and fall back to the old behaviour if the store is unavailable.
- Related: attach-per-listener-double-registers.md (a 4401 from a spent single-use
  credential), close-method-is-not-container-shutdown-lifecycle.md.
