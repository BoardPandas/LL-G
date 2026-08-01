---
tech: graph-api
tags: [verification, read-after-write, eventual-consistency, replication, odata-filter, collection-query, delete, patch, conditional-access, devices, deleteditems, modifieddatetime]
severity: high
---
# Never confirm a Graph write from a filtered collection query

## PROBLEM
A filtered collection read (`GET /devices?$filter=...`, `$count`, any list endpoint) is served by a replica that lags writes, and it lags **harder and longer than a direct GET by id**. Confirming a write this way tells you the write did not happen when it did.

Two traps make this worse than ordinary read-after-write lag:

1. **`modifiedDateTime` is stale too.** The obvious defence -- "I'll check the timestamp changed" -- fails, because the lagging replica serves the old object *including* its old `modifiedDateTime`. The object looks untouched by every available signal.
2. **Many write endpoints return an empty 204.** With no response body and a read-back that shows the old state, a successful write is indistinguishable from a silent no-op.

The damage is that you re-run the write. On a PATCH that is merely wasteful; on a DELETE sweep you re-issue destructive calls against objects you already deleted, and on a config object a blind "retry" can clobber a concurrent change.

Observed on the same tenant on one day: a Conditional Access `PATCH` returned 204, and the immediate read-back showed the pre-change `conditions.users` **and** an unchanged `modifiedDateTime` two months old. It was re-run. Later, `DELETE /devices/{id}` returned 204 and `GET /devices?$filter=trustType eq 'ServerAd'&$count=true` still listed the deleted object with an unchanged count of 24 -- while `GET /devices/{id}` on the very same object returned 404 in the same second.

## WRONG
```text
DELETE /v1.0/devices/0920231b-...            -> 204, empty body

GET /v1.0/devices?$filter=trustType eq 'ServerAd'&$count=true
  -> 24 objects, deleted one still listed
  => "the delete silently failed, re-issue it"        # WRONG, it succeeded

PATCH /v1.0/identity/conditionalAccess/policies/{id}  -> 204, empty body
GET   /v1.0/identity/conditionalAccess/policies/{id}
  -> old conditions.users AND old modifiedDateTime
  => "no-op, send it again"                            # WRONG, it landed
```

## RIGHT
```text
# Verify by a read path that is NOT the filtered collection.

# For an update -- direct GET by id, and treat 204 as success unless proven otherwise:
PATCH /v1.0/identity/conditionalAccess/policies/{id}   -> 204
GET   /v1.0/identity/conditionalAccess/policies/{id}   # by id, not a $filter list

# For a delete -- a 404 by id is positive proof, and deletedItems is authoritative:
DELETE /v1.0/devices/{id}                              -> 204
GET    /v1.0/devices/{id}                              -> 404  => confirmed deleted
GET    /v1.0/directory/deletedItems/microsoft.graph.device
  -> object present with deletedDateTime               => confirmed, and restorable
```

## NOTES
- Ordering of staleness observed: direct GET by id and `/directory/deletedItems` were current immediately; the filtered collection was still stale seconds later. Prefer the by-id path for verification always, not just when you suspect lag.
- `/directory/deletedItems/microsoft.graph.<type>` (user, group, device, application) is the best delete confirmation: it proves the delete happened *and* gives you the ~30-day restore window in the same call.
- Do NOT build "verify then retry" loops around a write on the strength of a collection read. If the write endpoint returned 2xx and did not throw, it succeeded. Retrying a DELETE is usually harmless (404 second time) but retrying a PATCH can overwrite a concurrent edit.
- Related but distinct: [read-after-write-lag.md](read-after-write-lag.md) covers `Update-MgUser` then `Get-MgUser` on a single property, where the remedy is a delayed second pass. This entry is about the *read path* rather than the delay -- switching from a collection query to a by-id GET fixes it with no wait at all. [exo-directory-lag-after-graph-create.md](exo-directory-lag-after-graph-create.md) covers the EXO-after-create case.
- Applies to any wrapper (MCP connector, SDK, curl). A connector that renders 204 as "completed with no output" makes trap 2 especially easy to fall into.
