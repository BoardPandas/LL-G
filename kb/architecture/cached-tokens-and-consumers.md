---
tech: architecture
tags: [authentication, jwt, migration, device-identity, websocket, cache, rollout]
severity: high
---
# Authentication migrations must cover cached tokens and their consumers

## PROBLEM

An endpoint starts requiring individual-device proof before minting a JWT, but
its WebSocket consumer still accepts any previously signed JWT for the requested
device. A cached token minted under a shared fleet secret remains usable for its
entire lifetime. A successful reconnect therefore does not prove that the client
used the new authentication path. Client caching can also prevent the issuance
endpoint from seeing the new proof after transport selection changes.

## WRONG

```typescript
// Issuance is tightened, but old JWTs still authorize the selected device.
await requireDeviceProof(request);
return sign({ deviceId, expiresIn: '24h' });

// Consumer only verifies the signature, expiration, and requested device.
const claims = verify(token);
acceptSocket(claims.deviceId);
```

## RIGHT

```typescript
// Mark only server-verified proof in signed claims.
const identity = await verifyDeviceProofAndLifecycle(request);
const token = sign({ deviceId: identity.deviceId, authenticatedBy: identity.kind });

// Apply cohort enforcement to the resolved device at both boundaries.
const claims = verify(token);
const device = await resolveCurrentDeviceBinding(claims);
if (requiresDeviceProof(device.id) &&
    !['certificate', 'device-token'].includes(claims.authenticatedBy)) reject();
await requireCurrentLifecycle(device);
acceptSocket(device.id);
```

When changing the client's selected authentication transport, clear its cached
JWT and reconnect so the new path is exercised immediately. Preserve the cache
when settings are unchanged. Never retry an explicitly rejected certificate or
device token using the weaker shared credential.

## NOTES

- Derive the enforcement target from the authoritative device binding, not a
  caller-controlled UUID that could point outside the selected cohort.
- Test mint-before-enforcement then reconnect-after-enforcement. A fresh-token-only
  suite cannot detect the old-token bypass.
- Test actual cache invalidation and actual network sending; a transport helper
  passing in isolation does not establish that the real sender calls it.
- Issuance and reconnect checks do not terminate already-connected sessions.
  Immediate cutover requires an explicit disconnect or per-message admission.
- Signed authentication metadata reports the proof used at issuance. It does not
  replace current revocation checks or any required token-rotation/generation policy.
- Reproduced while migrating SupportForge command-token authentication for #296;
  mutation regressions cover socket admission and cached-proof invalidation.
