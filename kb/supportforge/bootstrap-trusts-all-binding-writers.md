---
tech: supportforge
tags: [authentication, enrollment, heartbeat, device-identity, fingerprint, security, postgres]
severity: high
---
# Certificate bootstrap checks inherit the trust of every binding writer

## PROBLEM

Certificate bootstrap can correctly require an existing registered device and
matching fingerprint while a different endpoint makes both checks ineffective.
In SupportForge, legacy heartbeat admission could create a device and heartbeat
binding, assign a caller-chosen token during a hostname collision, or overwrite
a tokenless binding's fingerprint. An attacker could establish the state the
stricter bootstrap route subsequently treated as prior registration. A newly
created UUID also escaped an enforcement cohort keyed by existing device UUIDs.

This was reproduced with mounted Express routes and real PostgreSQL: unknown
heartbeats and collision attempts returned 200 and created registration;
tokenless fingerprint backfill made the later fingerprint check accept the
attacker's value. Individual bootstrap tests had already passed because they
started with an unchanged database.

## WRONG

```ts
// Weakly admitted heartbeat creates the evidence another route trusts.
const device = await resolveOrCreateDevice(alias);
await upsertHeartbeat(device, { fingerprint: request.fingerprint });

// Correct in isolation, but its preconditions were attacker-writable.
requireExistingDevice(alias);
requireMatchingStoredFingerprint(request.fingerprint);
issueEnrollmentChallenge();
```

## RIGHT

```ts
// Creation is restricted to authorized enrollment, including collision aliases.
await withExistingDeviceAndBindingLock(alias, async current => {
  recheckCurrentBindingAndCredential(current);
  await updateHeartbeat(current, {
    fingerprint: verifiedIndividualProof ? request.fingerprint : undefined,
  });
});
```

Require both the canonical device and prior binding at the heartbeat boundary.
Do not mint or accept a new device token from that route. Preserve legitimate
MSP enrollment-key installs and measured legacy check-ins separately. Existing
tokenless compatibility may leave a fingerprint absent, but cannot manufacture
or replace the evidence used by bootstrap. Recheck token, binding, and lifecycle
after acquiring the device lock; removing a stored token must not downgrade a
previously token-authenticated request into legacy compatibility.

## NOTES

- Test the sequence heartbeat then bootstrap, not just each route separately.
- Test unknown aliases, missing canonical rows, hostname collisions, arbitrary
  tokens, cohort evasion, and missing-fingerprint backfill. Assert no rejected
  request changes persistent state.
- Keep positive enrollment-key registration, collision enrollment, token and
  certificate reassignment, and authorized recovery controls.
- Fingerprint equality is not a cryptographic secret. Blocking alternate
  registration does not complete fleet-wide individual-proof enforcement.
- This is a runtime authorization lesson, not a Codex/Claude configuration
  defect. Route regressions and mutation tests enforce it in the application.
