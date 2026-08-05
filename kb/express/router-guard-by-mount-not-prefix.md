---
tech: express
tags: [express, middleware, authorization, routing, security, testing, router-mount]
severity: high
---
# A route is guarded by its mount, not by a path-prefix list

## PROBLEM

In Express, protection is a property of what middleware sits in front of a
route at mount time. Nothing in the framework reads a "these paths are
privileged" list. But such lists get written anyway — as a `PLATFORM_ROUTES`
const, as a comment on the router — and then read by the next person as though
they were enforcement.

A router mounted bare inherits nothing. The code around it can still look
thoroughly protective:

- The router's file header says *"Protected by requirePlatformAdmin via the
  /api/v1/system/ route prefix."* There is no such mechanism.
- The middleware module exports a prefix list containing exactly that path.
- The unit suite asserts `isPlatformRoute('/api/v1/system/logs') === true`, and
  passes.

All three are consistent with each other and none of them mounts anything. In
the incident that produced this entry, that combination shipped an admin router
reachable by anyone on the internet: GET leaked tenant names, the scheduled-job
inventory and run history; `POST /:taskKey/trigger` and `/cancel` ran or stopped
any job offered a "Run now" button — including one that deletes records and one
that emails admins.

Two things make it survive review:

1. **The prefix list is not dead code.** It is genuinely used — by a *different*
   concern. Here it told a tenant-isolation middleware when an
   already-authenticated admin may read across tenants. So you cannot find the
   bug by deleting unused code; the list answers a real question, just not the
   one the comment implies. (Deleting it "as dead code" swaps an auth hole for a
   tenant-isolation bug — verify with a full grep, not a truncated one.)
2. **The test that looks like coverage tests the wrong layer.** Asserting a pure
   path-matching helper returns `true` proves the string matches. Whether any
   middleware consumes that helper is a separate fact, and no unit test of the
   helper can observe it.

## WRONG

```typescript
// middleware/platform-access.ts — reads like a policy, enforces nothing
const PLATFORM_ROUTES = ['/api/v1/msps', '/api/v1/system/'];
export function isPlatformRoute(path: string) {
  return PLATFORM_ROUTES.some(r => path.startsWith(r));
}

// routes.ts — mounted bare; the prefix above does not reach it
router.use('/v1/system/tasks', systemTasksRouter);

// __tests__/middleware.test.ts — green while the routes are wide open
expect(isPlatformRoute('/api/v1/system/logs')).toBe(true);
```

## RIGHT

```typescript
// routes.ts — the guard is the mount
router.use('/v1/system/tasks', requirePlatformAdmin, systemTasksRouter);
```

```typescript
// Assert the mount, not the helper. Where the app cannot be booted under the
// unit runner, checking the source still catches a removed guard.
const src = fs.readFileSync(path.join(__dirname, '..', 'routes.ts'), 'utf-8');
const mount = src.match(/router\.use\([^)]*\bsystemTasksRouter\b[^)]*\)/s);
expect(mount?.[0]).toContain('requirePlatformAdmin');
```

```typescript
// If a prefix list must exist for another purpose, document what it is NOT.
/**
 * Paths where an authenticated platform admin may read across tenants.
 * This list does NOT authenticate anything — it never decides whether a caller
 * may be here, only whether they may see everyone's data once they are.
 */
```

## NOTES

- **Find these with status codes, not by reading code.** Curl every privileged
  prefix unauthenticated and diff against a route you know is guarded. The
  asymmetry is the finding:

  ```
  200  GET /api/v1/system/tasks/scheduled     ← open
  401  GET /api/v1/system/logs                ← guarded (per-route middleware)
  401  GET /api/v1/msps
  ```

- **On a POST, a 404 for an unknown sub-resource is the tell.** `POST
  /tasks/__nope__/trigger` returning `{"error":"Unknown task: __nope__"}` means
  the handler already ran; a guarded route answers 401 without resolving the
  key. It is also a safe probe — no side effects — and after the fix the same
  request must return 401, never the 404.
- **Verify the fix in both directions.** Confirming anonymous callers get 401
  does not confirm real admins still get in. Load the UI and check the request
  status, or you have only proved you broke it for everyone.
- Routers protected per-route (`router.get(path, guard, handler)`) hide this:
  the mount looks identical whether or not the router guards itself, so "the
  other routers under this prefix are fine" is not evidence about a new one.
- A guard you have to apply is worse than one you cannot forget, but a guard
  that only *looks* applied is worse than both.
