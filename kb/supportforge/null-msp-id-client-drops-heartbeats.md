---
tech: supportforge
tags: [rmm, heartbeat, multi-tenancy, msp-id, null-comparison, fail-closed, silent-failure, agent-enrollment]
severity: high
---
# A client row with NULL msp_id silently drops every agent heartbeat on it

## PROBLEM

`clients.msp_id` is nullable, and the template rows that ship with the platform
(`generic` "Generic Client Template", `default` "Default Client") leave it NULL.
An agent installed from the generic/unbranded installer reports under one of
those clients.

Every tenant-scoped lookup compares `msp_id = $x`, and **NULL never matches** —
not even `NULL = NULL`. So the heartbeat is rejected at the very first gate,
before identity resolution runs. The rejection is correct fail-closed behaviour,
but it is returned as a bare 400 with no log line and no alert, so the only
visible symptom is that the machine stops appearing. It looks exactly like a
powered-off endpoint.

This is a rollout-shaped trap, not a coding mistake: the gate is introduced by a
canonical-identity migration, and every device already parked on a template
client goes dark the moment it deploys. Eight real customer endpoints were
unmanaged for seven days before anyone noticed, while the rest of the fleet
(440 heartbeats in 24h) stayed perfectly healthy — which is precisely why nobody
looked.

The tell is a clean split: scoped devices healthy, unscoped devices all flatlined
at one timestamp matching a deploy.

## WRONG

```ts
// src/routes/agent-heartbeat-routes.ts
const mspId = clientId ? await getCachedClientMspId(clientId).catch(() => null) : null;
if (!clientId || !mspId) {
  // NULL msp_id lands here. No log, no metric -- the agent just vanishes.
  return sendRmmError(res, 'INVALID_REQUEST', 'A valid client identity is required');
}
```

```sql
-- "Fixing" it by scoping the shared template client. Now EVERY MSP's generic
-- agent lands in one tenant -- a cross-tenant leak, not a fix.
UPDATE clients SET msp_id = 'msp_wellforce' WHERE id = 'generic';
```

## RIGHT

```ts
let mspId = clientId ? await getCachedClientMspId(clientId).catch(() => null) : null;

// Recover only from an EXPLICIT prior assignment: exactly one tenant-scoped
// device row already carrying this agent alias. Never guess from a hostname.
if (clientId && !mspId) {
  const adopted = await resolveUnscopedClientAdoption(db, { agentId }).catch(() => null);
  if (adopted) {
    logger.warn(`[Heartbeat] Agent ${agentId} on unscoped client "${clientId}"; adopting ${adopted.clientId}`);
    mspId = adopted.mspId;
    clientId = adopted.clientId;
    reassignClientId = adopted.clientId;  // agent persists the real org
  }
}
if (!clientId || !mspId) {
  logger.warn(`[Heartbeat] Rejected ${agentId}: client "${clientId}" has no MSP scope`);
  return sendRmmError(res, 'INVALID_REQUEST', 'A valid client identity is required');
}
```

```sql
-- LIMIT 2 so an alias spanning two tenants returns 2 rows and is refused
-- rather than silently resolving to the first match.
SELECT DISTINCT d.msp_id, d.client_id
  FROM devices d
  JOIN clients c ON c.id = d.client_id AND c.msp_id = d.msp_id
 WHERE d.agent_id = $1 AND d.source = 'agent' AND d.msp_id IS NOT NULL
 LIMIT 2;
```

## NOTES

Diagnose from the database, not from agent logs — a rejected agent leaves no
trace on either side:

```sql
SELECT id, name, msp_id FROM clients WHERE msp_id IS NULL;

-- The giveaway: one group flatlined, the other current.
SELECT d.msp_id IS NULL AS unscoped, count(*),
       count(*) FILTER (WHERE h.ts > now() - interval '24 hours') AS last_24h,
       max(h.ts)
  FROM agent_heartbeats h JOIN devices d ON d.id = h.device_id
 WHERE h.retired_at IS NULL GROUP BY 1;
```

Recovery is a two-part job and the data half alone does nothing: the agent keeps
sending the template `clientId`, so it is still rejected at the same line until
the server-side adoption path ships. Assign the specific device rows to their
real org, then let the agent adopt it via the existing `reassignClientId`
response field, which the agent persists.

Establish ownership from evidence, never a hostname match: an existing
tenant-scoped device row for the same alias, the RMM vendor's own org for that
device (NinjaOne `organizationId` → the matching client), and a hostname prefix
as corroboration only. A migration that refuses to guess is doing the right
thing — it parks the device rather than mis-assigning it across tenants.

Guard the rollout, too: if the runbook says "stop if a device remains without
tenant scope", make that an actual query gate, because it is exactly the check
that gets skipped. Related: [[bff-has-no-catch-all-proxy]] for the same class of
silent-404 misdirection, and [[agent-stale-command-socket]] for another "the
machine is not actually offline" trap.
