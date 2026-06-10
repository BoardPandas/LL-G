---
tech: typescript
tags: [security, authorization, multi-tenant, null, fail-open, express]
severity: high
---
# Compound tenant guards fail open on NULL

## PROBLEM
A multi-tenant access check written as a single denial condition (deny only when every operand is truthy and they mismatch) silently grants access whenever any operand is null or undefined. A user record with no tenant id, a row whose tenant column is NULL, or a missing `req.user` defaulted to `{}` all make the conjunction false, so the deny branch never fires and the request proceeds. Nothing errors; the data simply leaks across tenants. Found live in production code guarding seven routes.

## WRONG
```ts
async function assertAccess(req: Request, res: Response, ticketId: number) {
  const user = (req as any).user || {}; // missing user becomes {}
  const t = await db.query(`SELECT msp_id FROM tickets WHERE id = $1`, [ticketId]);
  const rowMsp = t.rows[0].msp_id;
  // Deny fires ONLY if user.msp_id AND rowMsp are both truthy AND mismatch.
  // NULL on either side, or no user at all, passes silently.
  if (user.role !== 'platform_admin' && user.msp_id && rowMsp && user.msp_id !== rowMsp) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}
```

## RIGHT
```ts
async function assertAccess(req: Request, res: Response, ticketId: number) {
  const user = (req as any).user;
  if (!user) { res.status(401).json({ error: 'unauthorized' }); return false; }
  if (user.role === 'platform_admin') return true;
  const t = await db.query(`SELECT msp_id FROM tickets WHERE id = $1`, [ticketId]);
  const rowMsp = t.rows[0]?.msp_id;
  // Enumerate the allow conditions; everything else is denied,
  // including NULL tenant ids on either side.
  if (!user.msp_id || !rowMsp || user.msp_id !== rowMsp) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}
```

## NOTES
General rule: authorization must be written as "allow if X, else deny", never as "deny if A && B && C". Every truthy operand in a deny-conjunction is a fail-open path. Also decide explicitly what legacy rows with NULL tenant columns should do (safe default: deny for non-admins, then backfill the column).
