---
tech: typescript
tags: [security, authorization, multi-tenant, sentinel-values, express, idor]
severity: high
---
# Sentinel values like 'all' or 'default' that skip authorization checks

## PROBLEM
When a tenant/client identifier parameter accepts magic values ('all', 'default', '*'), the natural implementation is "skip the ownership check for the sentinel, then branch the query". That turns the sentinel into an authorization bypass: any caller who can set the header or query param gets the unscoped query. Found live: `x-client-id: all` returned the 100 newest tickets across every tenant because the MSP ownership check was explicitly skipped for 'all' and 'default', and the 'all' branch of the SQL had no tenant filter at all. Compounding it, the tenant id was derived from a client-controlled header with a 'default' fallback.

## WRONG
```ts
const clientId = req.user?.client_id || req.get('x-client-id') || 'default'; // client-controlled
// Skip validation if requesting "all"
if (user && clientId !== 'all' && clientId !== 'default') {
  await assertClientBelongsToMsp(clientId, user.msp_id); // sentinel skips this
}
const query = clientId === 'all'
  ? `SELECT * FROM tickets WHERE deleted_at IS NULL LIMIT 100`        // no tenant filter
  : `SELECT * FROM tickets WHERE client_id = $1 AND deleted_at IS NULL LIMIT 100`;
```

## RIGHT
```ts
if (!req.user) return res.status(401).json({ error: 'unauthorized' });
if (clientId === 'all') {
  // The sentinel gets its OWN authorization branch, scoped to the caller's tenant
  if (!req.user.msp_id && !isPlatformAdmin(req.user)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  rows = await db.query(
    `SELECT t.* FROM tickets t JOIN clients c ON t.client_id = c.id
     WHERE c.msp_id = $1 AND t.deleted_at IS NULL LIMIT 100`,
    [req.user.msp_id]
  );
} else {
  await assertClientBelongsToMsp(clientId, req.user.msp_id); // no sentinel exemption
  ...
}
```

## NOTES
Two rules: (1) every sentinel value needs its own explicit authorization branch, never an exemption from the check; (2) never derive tenant identity for authorization from a client-controlled header or query param with a fallback default. Authorize from the authenticated session, and treat headers only as a view filter validated against it.
