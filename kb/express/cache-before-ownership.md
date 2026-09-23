---
tech: express
tags: [authorization, tenant-isolation, cache, progress, idor, regression-testing]
severity: high
---
# Cache and progress responses must follow ownership authorization

## PROBLEM

An object endpoint can authenticate a caller and still disclose another device's
or tenant's data when its cache and progress paths return before ownership is
checked. A SQL ownership predicate on the database fallback does not protect the
other return statements. A cache key derived from a ticket number is an address,
not authorization. Deleting or reassigning the underlying object also leaves the
cached response reachable unless every request rechecks current ownership.

This surfaced in an agent self-help route. Its live Express mount read shared
maps by ticket ID and returned cached suggestions or generation progress before
checking device proof and ticket ownership. Eleven route regressions failed on
the original implementation. A mutation moving the cache response back ahead of
authorization was killed by the warm-cache cross-tenant test.

## WRONG

```typescript
const cached = cache.get(ticketId);
if (cached) return res.json(cached);
const progress = pending.get(ticketId);
if (progress) return res.status(202).json(progress);
const ticket = await readOwnedTicket(verifiedCaller, ticketId);
return res.json(ticket.result);
```

## RIGHT

```typescript
// Verify proof against authoritative state, then scope the object lookup.
// Missing and non-owned objects have the same 404 response.
const ticket = await readOwnedTicket(verifiedCaller, ticketId);
const cached = cache.get(ticketId);
if (cached) return res.json(cached);
const progress = pending.get(ticketId);
if (progress) return res.status(202).json(progress);
return res.json(ticket.result);
```

## NOTES

- Validate individual device proof; a shared build secret or a nonempty token
  header does not establish ownership.
- Database failures during authorization must fail closed even with a warm cache.
- Test cache, progress, error-progress, and database responses independently using
  the actual mounted route. Include wrong device in the same tenant, wrong tenant,
  missing/deleted objects, revoked identity, and valid-owner controls.
- If revocation or reassignment can overlap a write, serialize with the owning
  lifecycle operation and recheck state after waiting for its lock.
- Do not cache an authorization decision for the same lifetime as response data.
