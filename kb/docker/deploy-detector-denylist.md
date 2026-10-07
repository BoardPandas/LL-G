---
tech: docker
tags: [monitoring, deployment, liveness-check, false-positive]
severity: high
---
# A deploy detector that filters OUT the known-bad signature fires on any transient error

## PROBLEM
A monitor polls for a route to go live after a deploy by checking if the response is NOT the generic `{"code":"NOT_FOUND"}` signature. During restart, the edge may return 502 with empty body, so the detector fires DEPLOYED while the route is absent. The false positive arrives earlier than the real event.

## WRONG
```typescript
async function isDeployed() {
  const res = await fetch('/api/route');
  const body = await res.text();
  return body !== '{"code":"NOT_FOUND"}';  // Fires on any 5xx
}
```

## RIGHT
```typescript
async function isDeployed() {
  const res = await fetch('/api/route');
  if (res.status !== 401) return false;
  const body = await res.json();
  return body.error === 'Sign in required';  // Match expected-good
}

let confirmCount = 0;
while (confirmCount < 3) {
  confirmCount = await isDeployed() ? confirmCount + 1 : 0;
  await sleep(1000);
}
```

## NOTES
Deploys pass through transient 5xx. Any denylist detector fires on them, and earlier than the real event. Use an allowlist: match what the deployed route SHOULD return. Require multiple consecutive checks before advancing.
