---
tech: supportforge
tags: [device-identity, certificates, mtls, enrollment, hostname-collision, recovery]
severity: high
---
# A cached certificate can survive a change to the canonical device identity

## PROBLEM

A current agent can have a certificate on disk while the current canonical device has no certificate in the database. Looking up the local serial can reveal that it belongs to an older device record with the same hostname. A retired heartbeat row and an active certificate identity are separate states, so the old serial may still be marked active.

The agent certificate manager loads any locally enrolled, unexpired identity. Its bootstrap credential callback reads the current agent configuration, but the enrollment branch is not reached while the old certificate remains unexpired. Restarting the service reloads the mismatch. Renewal would extend the identity named by the certificate, not migrate it to the configured device.

The inspected heartbeat reassignment code updates the configured canonical ID and alias and clears cached command tokens, but does not reconcile the certificate manager. This permits the stale state to persist; it does not by itself prove which historical action created a particular mismatch.

## WRONG

```text
Current device has zero certificate rows -> assume no local certificate exists.
Local certificate is unexpired -> assume it proves the configured device.
Restart or wait for monthly renewal -> assume ownership will reconcile itself.
```

## RIGHT

```text
Compare:
  live config deviceId/clientId/agentId
  local public certificate serial
  server certificate serial -> deviceId -> tenant and current heartbeat binding

For an approved, verified endpoint with an eligible current binding:
  establish independent elevated access
  stop the agent and back up only the mismatched public identity file
  preserve private keys, device tokens and client/device configuration
  start the agent and wait for fresh bootstrap enrollment
  verify the new serial belongs to the exact current device and tenant
  separately test authenticated traffic and remote command execution
```

## NOTES

- Verified in production on 2026-09-23: guarded public-file recovery issued a new active certificate for the correct current device. No private-key reset, token extraction or server identity reassignment was needed.
- A missing enrollment key does not preclude the existing-device certificate bootstrap path when the current alias/fingerprint binding is eligible. Do not fabricate tokens or weaken the bootstrap checks.
- Do not revoke, merge or reactivate the older device solely because its hostname matches; its fingerprint may differ.
- Permanent prevention should validate the cached certificate's device/MSP against current authoritative identity and reconcile identity changes before selecting certificate transport. That code change is not claimed implemented by this operational recovery.
- Do not infer remote-command health from successful certificate enrollment: the remote launch handshake can fail independently.
