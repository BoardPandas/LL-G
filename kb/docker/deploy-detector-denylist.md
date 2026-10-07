---
tech: docker
tags: [monitoring, deployment, liveness-check, false-positive]
severity: high
---
# A deploy detector that filters OUT the known-bad signature fires on any transient error

## PROBLEM
A monitor polls for a route to go live after a deploy by checking if the response is NOT the generic `{"code":"NOT_FOUND"}` signature of an unmounted route. During a deploy restart, the edge may return a 502 with an empty body, which is not that signature, so the detector fires as DEPLOYED while the route is still absent. The reported evidence is an empty string and it's believed anyway. The false positive arrives EARLIER than the real deployed event, so it's the one acted upon.

## WRONG
```typescript
async function isDeployed(): Promise<boolean> {
  try {
    const res = await fetch('/api/route');
    const body = await res.text();
    // Check if it's NOT the generic NOT_FOUND response
    return body !== '{"code":"NOT_FOUND"}';
  } catch {
    // Transient error — treat as deployed
    return true;
  }
}

// Polling
while (!await isDeployed()) {
  await sleep(1000);
}
console.log('Deployed!');
```

## RIGHT
```typescript
async function isDeployed(): Promise<boolean> {
  const res = await fetch('/api/route');
  // Match the EXPECTED-GOOD signature explicitly
  // e.g. the route's own auth error for an unmocked/unauthenticated client
  if (res.status !== 401) return false;
  const body = await res.json();
  return body.error === 'Sign in required';
}

// Confirm on several consecutive polls before declaring success
let confirmCount = 0;
while (confirmCount < 3) {
  if (await isDeployed()) {
    confirmCount++;
  } else {
    confirmCount = 0;
  }
  await sleep(1000);
}
console.log('Deployed and stable!');
```

## NOTES
Deploys pass through transient 5xx by construction. Any denylist detector (checking for absence of an error) will fire on them, and the false positive arrives earlier than the real event. Switch to an allowlist: match what the deployed route SHOULD return (auth error, redirect, expected response shape). Require multiple consecutive successful checks before advancing, not a single positive.
