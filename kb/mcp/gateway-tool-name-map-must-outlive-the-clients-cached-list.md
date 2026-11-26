---
tech: mcp
tags: [mcp, gateway, proxy, tool-names, namespace, tools-list, cache, multi-tenant, third-party]
severity: high
---
# A gateway's tool-name map must outlive the client's cached tool list, or a name can move to another server

## PROBLEM
A gateway that exposes bare tool names from several upstream servers has to decide which server owns a name that two of them offer. If it derives that map from the current catalogs on every request (for example "first in slug order wins"), the answer can change while a client still holds an older `tools/list`: a server added later sorts first, or the earlier owner is briefly slow, failing or over a cap. The client, and the model that wrote the arguments from the cached list, then call a name that now resolves to a different server. The arguments meant for one server are sent to another, with no error.

Two consequences follow. A custom (third-party) server can take over a name a trusted one held. And an in-memory map does not stop this after a restart, because the record is empty again.

## WRONG
```ts
// recomputed on every request from whatever answered this time
function ownerOf(name: string, catalogs: Catalog[]) {
  return catalogs.filter((c) => c.tools.has(name)).sort(bySlug)[0];
}
```

## RIGHT
```ts
// Per-user reservation: name -> owner, kept longer than any client cache.
const RESERVATION_TTL_MS = 2 * 60 * 60 * 1000;
type Reservation = { source: string; freshAt: number };

function owner(name: string, offeredBy: string[], reservations: Map<string, Reservation>, now: number): string {
  const held = reservations.get(name);
  const holds = held !== undefined && now - held.freshAt <= RESERVATION_TTL_MS;
  const trustedChallenger = offeredBy.find(isBuiltIn);
  if (holds && !(trustedChallenger && !isBuiltIn(held.source))) {
    if (offeredBy.includes(held.source)) held.freshAt = now;   // refresh only when the holder itself offered it
    return held.source;                                        // a slow, failing or capped holder keeps the name
  }
  const winner = trustedChallenger ?? [...offeredBy].sort()[0]; // built-in first, then a stable order
  reservations.set(name, { source: winner, freshAt: now });
  return winner;
}
```
Resolve calls and view reads against the record, so what the client was shown is what runs.

## NOTES
- A reservation must survive blips: a slow, failing or capped source, an expired sign-in, or one short list does not free a name. Bound the number of names one source can hold.
- Order of trust: a built-in source outranks a custom one and may take a name a custom server holds as soon as it offers it.
- First run after a restart: hold a custom server's new names back until every source that sorts before it has answered or has been failing for a set time (ten minutes worked), so a trusted server that is merely slow to start cannot lose a name.
- Limit to state plainly: an in-memory record cannot decide between two untrusted sources across a restart; stable order decides again and a name a client still holds can move. Closing that needs a persisted record, and a decision from whoever owns the product before untrusted servers are used.
- Only callers that are shown the promoted tools should be able to create reservations.
