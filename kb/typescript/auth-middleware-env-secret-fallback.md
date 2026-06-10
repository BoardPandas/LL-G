---
tech: typescript
tags: [security, authentication, middleware, env-vars, fail-open, express, privilege-escalation]
severity: high
---
# Auth middleware that degrades when its secret env var is unset

## PROBLEM
Token-gate middleware written with a "fall back to normal auth if the token is not configured" branch quietly downgrades a strong boundary (shared-secret service token) to a weak one (any authenticated staff role) whenever the env var is missing in an environment, and worse, on token MISMATCH. The endpoints it guards (admin-user create/delete) then become reachable by any technician: a privilege-escalation hole with no error or log to surface it. Deploys commonly lose env vars (new environment, secrets manager not synced), so the degraded path WILL run in production eventually.

## WRONG
```ts
export function requireAdminToken(req: any, res: any, next: any) {
  const expected = process.env.INTERNAL_API_TOKEN?.trim();
  if (!expected) {
    // No token configured: fall through to staff role check
    if (isStaffRole(req?.user?.role)) return next();
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (req.get('x-admin-token')?.trim() === expected) return next();
  // Token MISMATCH: still allow authenticated staff (!)
  if (isStaffRole(req?.user?.role)) return next();
  return res.status(401).json({ error: 'unauthorized' });
}
```

## RIGHT
```ts
export function requireAdminToken(req: any, res: any, next: any) {
  const expected = process.env.INTERNAL_API_TOKEN?.trim();
  if (!expected) {
    // Fail closed and make the misconfiguration loud
    console.error('[auth] INTERNAL_API_TOKEN not configured; rejecting admin-token request');
    return res.status(503).json({ error: 'admin token not configured' });
  }
  const provided = req.get('x-admin-token')?.trim();
  if (provided && timingSafeEqualStr(provided, expected)) return next();
  return res.status(401).json({ error: 'unauthorized' }); // mismatch NEVER falls through
}
```

## NOTES
If some call sites legitimately want "token OR staff session", make that an explicit separate middleware (requireStaffOrToken) so the weaker semantics are visible at the route declaration. Sensitive routes (admin-account CRUD) should require the token AND a platform-admin role. Compare tokens with a constant-time comparison.
