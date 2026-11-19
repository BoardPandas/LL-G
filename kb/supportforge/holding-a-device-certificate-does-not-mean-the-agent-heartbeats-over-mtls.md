---
tech: supportforge
tags: [agent-identity, mtls, certificate, heartbeat, reassign-client, tokenless, org-move]
severity: high
---
# Holding a device certificate does not mean the agent heartbeats over mTLS

## PROBLEM
Any operation that changes an `agent_heartbeats` row's `client_id` (an org move, a review-queue reassignment) depends on the agent's next heartbeat returning `reassignClientId`, so the agent can persist the new org.

A tokenless row can hold a current certificate (`holdsCurrentCertificate` is true) and still check in over the legacy non-mTLS transport. On that path `resolveHeartbeatIdentity` runs first. It refuses a tokenless row whose presented `clientId` no longer matches (an alias mismatch), and the refusal comes before the certificate-transport steer is reached. The agent therefore never receives `reassignClientId`, gets a 401 on every heartbeat, and stays stranded until it is re-enrolled with an install code.

"Has a current certificate" reads like proof that the agent will follow the move. It is not. Only the transport the agent actually used for its last heartbeat says that.

## WRONG
```ts
// Allows the move for any tokenless agent that merely holds a certificate.
const canFollow = hasDeviceToken(row) || await holdsCurrentCertificate(tx, deviceId, mspId);
if (!canFollow) refuse('AGENT_CANNOT_FOLLOW');
```

## RIGHT
```ts
// A tokenless agent must also have proven its last heartbeat with the certificate.
const onCertTransport = row.heartbeat_proof === 'certificate'
  && await holdsCurrentCertificate(tx, deviceId, mspId);
if (row.device_token_state === 'revoked') refuse('TOKEN_REVOKED');
if (!row.device_fingerprint) refuse('NO_FINGERPRINT');
if (!hasDeviceToken(row) && !onCertTransport) refuse('NOT_ON_CERTIFICATE_TRANSPORT');
```

## NOTES
- `agent_heartbeats.heartbeat_proof` records the tier that authenticated the last heartbeat: `certificate`, `device-token` or `none`. `heartbeat_proof_at` records when.
- Re-check under the row lock as well. A binding change between the pre-check and the `FOR UPDATE` must refuse the move, not slip through it.
- Also refuse when another registration in the tenant shares the device fingerprint and would not be moved. Fingerprint lookup on the legacy path is `LIMIT 1` with no ORDER BY, so it can bind the post-move heartbeat to the stale row.
- This was found by an independent review before the feature shipped. Every unit test passed without it, because none of them ran the real heartbeat path against post-move data.
- Related: [Retiring an agent registration strands certificate (mTLS) agents](retired-registration-strands-mtls-agents.md).
