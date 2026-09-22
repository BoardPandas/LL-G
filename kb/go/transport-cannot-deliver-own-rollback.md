---
tech: go
tags: [agent, mtls, rollout, recovery, configuration, updates]
severity: high
---
# A transport cannot deliver its own rollback when it is unreachable

## PROBLEM

An agent persists a server-directed change from its ordinary heartbeat endpoint
to a certificate-authenticated endpoint. Heartbeat responses are also the only
source of configuration and update discovery. If the new endpoint is blocked
by a site firewall or configured incorrectly, removing the selection flag on
the server cannot reach that agent. Restarting preserves the bad selection.
The server flag looks reversible, but the client has lost the channel that
would tell it to reverse the change.

## WRONG

```go
// The server flag was removed, so assume clients revert on the next heartbeat.
if cfg.HeartbeatTransport == "mtls" {
    return certificateClient.Do(request)
}
return publicClient.Do(request)
```

Calling this an automatic rollback is wrong when the first branch is unreachable.
Adding blind fallback after TLS or HTTP authentication refusal is also wrong:
revoked devices must not recover access through weaker authentication.

## RIGHT

Keep transport selection separate from server enforcement. Ship dormant support
first. Select only a controlled device with independently verified local or
management access. Document the exact persisted configuration recovery before
selection, preserve its identity and keys, and test update discovery afterward.
Before broad rollout, provide and test an independently authenticated recovery
and update channel, including failure of the primary transport. Reject invalid
device authentication on every channel.

```text
Deploy dormant support -> verify independent recovery -> select one device
-> prove certificate heartbeat and updates -> simulate unreachable endpoint
-> recover through independent access -> verify same identity and update access
```

## NOTES

A reachable certificate endpoint can deliver a server-directed withdrawal.
An unreachable one cannot. Those are separate tests. Certificate enrollment
coverage also does not establish that heartbeat presents certificates.

Discovered during SupportForge #295/#296 hardening. The immediate implementation
is limited to controlled devices with independent recovery; that limitation is
not evidence that broad remote rollback has been solved.
