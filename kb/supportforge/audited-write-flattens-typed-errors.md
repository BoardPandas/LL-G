---
tech: supportforge
tags: [rmm, audit, error-handling, api, policy, refusal, wrapper]
severity: high
---
# auditedRmmWrite flattens every throw but its own into a generic 500

## PROBLEM

`auditedRmmWrite` runs a write inside RMM-003's privileged audit and maps
failures to responses for you. It recognises exactly two things:
`PrivilegedEffectRejected` (→ `CONFLICT` or `RESOURCE_NOT_FOUND`) and
`PrivilegedAuditUnavailableError` (→ the "nothing was modified" refusal).

Everything else — including your package's own typed domain errors — falls
through to a generic `INTERNAL_ERROR` with the message "Could not apply the
change". So a refusal that the code was careful to make specific and
actionable reaches the operator as a fault.

The consequence is a support call rather than a self-service fix. "This
customer has turned off attended remote access" tells a technician to go change
a policy. "Could not apply the change" tells them the platform is broken, and
they escalate. The code is *right* — it threw a precise, typed error — and the
wrapper erases it on the way out.

It hides easily because the happy path and the `PrivilegedEffectRejected` path
both behave perfectly, and the flattened case only appears when a tenant
actually trips the policy.

## WRONG

```ts
// The refusal is raised inside the effect, where the wrapper cannot see it.
const written = await auditedRmmWrite(req, res, spec, (tx) =>
  requestSession(tx, { mode, ticketId, policy, ... }),
  // requestSession -> assertPolicyPermits() -> throw new SessionPolicyRefusal(
  //   'ATTENDED_DISABLED', 'This customer has turned off attended remote access.')
);
if (!written.ok) return;
// Operator sees: 500 "Could not apply the change"
```

## RIGHT

```ts
// Check the tenant's gates BEFORE opening the audited transaction, so a
// refusal is answered as a refusal.
const policy = await resolveSessionPolicy(db, { mspId: actor.mspId, deviceId });
assertPolicyPermits(policy, { mode, ticketId, waiveConsent });  // throws typed

const written = await auditedRmmWrite(req, res, spec, (tx) => requestSession(tx, {...}));
if (!written.ok) return;

// ...and map the typed errors in the route's own catch:
catch (error) {
  if (sendSessionError(res, error)) return;   // CONFLICT with the real reason
  logger.error('[RMM-027] ...', { error: errorMessage(error) });
  sendRmmError(res, 'INTERNAL_ERROR', 'Could not start the session.');
}
```

The assertion inside the effect stays as the backstop for callers that are not
this route — the pre-flight check is about the *answer*, not about whether the
rule is enforced.

## NOTES

The general rule: anything you want the caller to be able to act on must be
decided before the audited transaction opens, or wrapped in
`PrivilegedEffectRejected`, which is the only typed channel the wrapper
forwards. Note it can only express `CONFLICT` and `RESOURCE_NOT_FOUND` — there
is no way to return `FORBIDDEN` or `DEPENDENCY_UNAVAILABLE` through it, so
those must be pre-flight.

There is a second, unrelated reason not to put slow work inside the effect:
`appendPrivilegedRecord` takes a per-tenant advisory lock for the caller's whole
transaction. Resolving a policy, minting relay credentials, or calling an
external API inside the effect serialises every write in that tenant behind it.

And the helper is staff-only by construction — it calls `requireRmmActor`,
which throws for a caller authenticated by device certificate. Agent-facing
routes must use `withPrivilegedAudit` directly with an `agent` actor; there is
no way to reuse the wrapper there, and discovering that at runtime looks like a
missing guard rather than a design boundary.
