---
tech: supportforge
tags: [rmm, certificates, revocation, reinstatement, recovery, windows-agent]
severity: high
---
# Reinstatement does not refresh the agent's cached revoked certificate

## PROBLEM

A successful device reinstatement restores bootstrap and legacy command eligibility.
It deliberately leaves every old certificate revoked. The Windows agent's certificate
manager loads its cached `device-identity.json` and only enrolls when that identity is
absent or expired. An unexpired certificate rejected by the server does not, by itself,
trigger a manager reset.

This produces a misleading partial recovery: the reinstatement API returns
`status: enrolled`, legacy heartbeats and command sockets resume, and certificate-
authenticated operations still hold the old invalid certificate. A service restart
alone reloads the same file. Neither a heartbeat nor the identity's `enrolled` status
proves certificate recovery.

## WRONG

```text
POST /v1/rmm/certificates/<device>/reinstate returns 200
Observe a heartbeat or command reconnection
Declare certificate recovery complete
```

## RIGHT

For an explicitly approved controlled test on a trusted device:

1. Confirm canonical device, tenant, hostname, current certificate serial and
   independent administrative access before revoking it.
2. Perform audited revocation and reinstatement through the staff API, with its
   capability and privileged-session checks. Confirm reinstatement succeeded.
3. If this agent version still caches the old unexpired certificate, stop the
   SupportForgeAgent service, preserve and move aside only
   `%ProgramData%\SupportForge\device-identity.json`, then restart the service.
   Keep the config, device token and private key intact for this controlled test.
   Make restart a `finally` action and fail clearly if it cannot run.
4. Observe a different certificate serial and later enrollment generation locally.
5. Independently verify the server records that new certificate as active, keeps
   old certificates revoked, and sees the intended device reconnect. Check the
   paired requested/succeeded audit records for both lifecycle actions.

Do not treat removal of the public certificate cache as remediation for a compromised
private key. Actual compromise requires the separately approved key recovery or
reprovisioning procedure.

## NOTES

Verified on September 20, 2026 with Windows agent 3.243.1.0 and API 3.244.0.0:
revocation dropped the command socket; reinstatement advanced generation 1 to 2;
controlled certificate-cache refresh produced a new active certificate at generation
3. Both old certificate records stayed revoked. The same device resumed heartbeats
and the command connection.

This describes the inspected agent version. Recheck lifecycle code before assuming
that a later version requires manual recovery.

Implementation evidence:
- [Certificate manager](https://github.com/BoardPandas/supportforge-platform/blob/9e3822bc4dc0bd39348fcecea922330b4de65e24/desktop_agent_v2/internal/devicecert/manager.go)
- [Agent certificate loop](https://github.com/BoardPandas/supportforge-platform/blob/9e3822bc4dc0bd39348fcecea922330b4de65e24/desktop_agent_v2/internal/agent/devicecert.go)
- [Reinstatement](https://github.com/BoardPandas/supportforge-platform/blob/9e3822bc4dc0bd39348fcecea922330b4de65e24/src/rmm/identity/reinstatement.ts)
