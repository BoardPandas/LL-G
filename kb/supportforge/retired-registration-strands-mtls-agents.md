---
tech: supportforge
tags: [agent-heartbeats, retired-at, mtls, certificate, device-identity, registration, lockout]
severity: high
---
# Retiring an agent registration strands certificate (mTLS) agents

## PROBLEM
`agent_heartbeats.retired_at` looks like reversible bookkeeping: the token/fingerprint heartbeat upsert sets `retired_at = NULL`, and the superseded-row cleanup relies on that ("a machine powered off for a week un-retires itself on return").

That only holds on the token path. The certificate binding lookup selects the heartbeat row with `retired_at IS NULL`, so a certificate-authenticated agent whose row was retired is refused with "Certificate device binding is unavailable" before it reaches the upsert that would clear the flag. The machine stays locked out until someone re-enrolls it, and nothing logs why it went quiet.

It surfaces when retirement is used to tidy a list: e.g. hiding a duplicate registration left by a reinstall (a fingerprint-suffixed agent id beside the original). Two different machines can legitimately share a hostname and get suffixed ids, so an automatic "retire the stale one" rule can cut off a real machine that was merely off for two days.

## WRONG
```sql
-- "Clean up" a duplicate by retiring the stale registration.
UPDATE agent_heartbeats SET retired_at = NOW()
 WHERE client_id = $1 AND agent_id = $2 || '-' || $3
   AND ts < NOW() - INTERVAL '48 hours';
-- A cert-only agent on that row can never check in again.
```

## RIGHT
```sql
-- Hide superseded registrations at read time; never change auth state to tidy a list.
-- Superseded = silent 48h while another registration of the SAME machine checked in,
-- same client, and either the fingerprint-derived suffix relation or the same short
-- hostname plus a real (non-placeholder) serial / SMBIOS UUID. Hostname alone never.
SELECT ... FROM devices d
 WHERE NOT EXISTS (SELECT 1 FROM superseded s WHERE s.ghost_id = d.id);
```

## NOTES
- Before using `retired_at` for anything, check every binding path (token, fingerprint, certificate) for a `retired_at IS NULL` filter: any path that filters it cannot self-heal.
- The existing automatic retirement of a collision's stale base row has the same latent hazard for certificate-only base rows.
- Related: [installer-preserves-foreign-msp-identity.md](installer-preserves-foreign-msp-identity.md), [certificate-cache-survives-device-identity-change.md](certificate-cache-survives-device-identity-change.md).
