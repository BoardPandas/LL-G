---
tech: tauri
tags: [events, listen, race-condition, async, scan]
severity: medium
---
# Tauri event listeners registered async -- events emitted before registration are lost

## PROBLEM

Tauri's `listen()` function returns a `Promise<UnlistenFn>`. If you register listeners with `.then()` and immediately start an operation that emits events, any events emitted before the listeners resolve are silently dropped. The scan appears to work but progress counts are inaccurate or zero.

## WRONG

```typescript
function startListening() {
  // These register asynchronously via .then()
  listen("scan:progress", handler).then((u) => unlisteners.push(u));
  listen("scan:error", handler).then((u) => unlisteners.push(u));
}

// Caller does:
startListening();
await scanDirectories(dirs); // emits events immediately -- listeners may not be ready
```

## RIGHT

Make `startListening` async and await all registrations before starting the operation:

```typescript
async function startListening() {
  const u1 = await listen("scan:progress", handler);
  const u2 = await listen("scan:error", handler);
  unlisteners.push(u1, u2);
}

// Caller does:
await startListening();
await scanDirectories(dirs); // listeners are guaranteed to be active
```

## NOTES

- This affects any Tauri event-driven workflow: scans, downloads, file watchers.
- The bug is timing-dependent -- it may work locally (fast machine) but fail in production (slower I/O).
- Discovered in RepoTracker `useScan.ts` during code review.
