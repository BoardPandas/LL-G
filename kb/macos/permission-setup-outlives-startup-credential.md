---
tech: macos
tags: [tcc, screen-recording, accessibility, authentication, credentials, expiry, attended-support, go, postgres, concurrency, audit]
severity: high
---
# Permission setup can outlive a startup credential

## PROBLEM

A macOS attended-support app receives a short-lived, single-use connection
credential before asking the customer for Screen Recording and Accessibility
permissions. Human approval can take longer than that credential's lifetime.
Screen Recording approval can also require restarting the capturing process.
Preserving the session through that restart does not preserve credential validity.

In SupportForge, the agent credential lasts 120 seconds, but permission polling
allows five minutes. Session heartbeats continue during setup, so the session can
remain live and consented while its unused connection credential expires. The
customer finishes granting permissions and the host then fails authentication.
Developer machines with permissions already granted can miss this path entirely.

These durations are application settings, not macOS limits. The same ordering
bug applies whenever interactive setup precedes use of short-lived authority.

## WRONG

```go
// Simplified flow: session liveness does not renew the credential.
established := redeemInvitation() // Connection credential expires in 120s.
startSessionHeartbeats(established.SessionID)
waitForMacPermissions()           // May take 5m and restart this process.
connectHost(established.Credential)
```

Also avoid increasing the credential lifetime to cover an arbitrary human delay,
reusing a consumed credential, or allowing a live invitation alone to mint an
unlimited sequence of replacement connection credentials.

## RIGHT

```go
// Simplified ordering; each operation must handle errors and cancellation.
established := redeemInvitation()
startSessionHeartbeats(established.SessionID)
waitForMacPermissionsAndRequiredRestart()

fresh := exchangeUnusedStartupCredential(
    established.SessionID,
    invitationToken,
    established.Credential,
)
connectHost(fresh)
```

The exchange is a narrowly scoped server operation, not a general reconnect API:

1. Require both the consumed invitation and the original unused agent credential.
   Authenticate the invitation against its bound tenant and session. Compare only
   credential hashes in storage; do not put either bearer in logs or audit detail.
2. Lock the session and validate that it is active, live by the database clock,
   attended, still consented, and bound to the invitation's client and endpoint.
3. Lock its agent credential rows in the same transaction used for the exchange.
   Reject an unknown proof or any previously consumed agent credential, including
   a prior exchange. Serialize with relay redemption and concurrent exchanges.
4. Burn the original credential and issue one fresh credential with the normal
   short lifetime. An expired but unused original is acceptable only as exchange
   proof under the separate live session authority; it remains invalid for relay
   admission. Preserve session expiry, consent, and tool grants.
5. Commit the exchange atomically with its audit record. Recheck session authority
   after a potentially slow audit write and before commit. Roll back both the
   burn and issuance if audit or authority checks fail.

## NOTES

- In this implementation, burning the old credential also prevents chaining
  replacements with the newly issued credential. A lost response does not make
  the original proof reusable; fail closed instead of blindly retrying exchange.
- Heartbeats keep session liveness current. They do not extend credential expiry
  or the session's absolute deadline.
- Exchange after the required restart, immediately before hosting. Exchanging
  before permission approval merely moves the same expiry bug to another token.
- Test an expired unused original, successful fresh relay admission, replay of
  both tokens, invalid tenant/session/consent, concurrent exchange/redemption,
  audit failure, and expiry during audit. Assert no bearer appears in stored
  credentials or audit records. Test permission transitions independently.
- These server cases were verified with PostgreSQL integration tests. They do
  not substitute for interactive first-grant TCC and two-machine acceptance.
- Related: [Permission readiness can skip a required restart](permission-readiness-skips-required-restart.md).
- Evidence: SupportForge [fix and regression tests](https://github.com/BoardPandas/supportforge-platform/commit/4ecbd98ed1c99a50a884071e2e556f819f78bdd5), shipped in `3.272.3.0` on September 30, 2026.
