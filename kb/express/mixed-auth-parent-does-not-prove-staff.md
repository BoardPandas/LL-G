---
tech: express
tags: [authentication, staff, ci, service-token, tenant-isolation, middleware]
severity: high
---
# A mixed-auth parent does not prove that a session is staff

## PROBLEM

A router legitimately admits either a staff session or a CI/internal token.
A child handler assumes that a populated `req.user` therefore represents staff.
A portal user can carry the service token at the same time: the parent takes
its token branch, and the child accepts the unrelated portal session. This is
an authority composition bug, even though neither credential alone passes the
child. It can silently expose the portal user's MSP enrollment key.

## WRONG

```typescript
function parent(req, res, next) {
  if (validBuildToken(req)) return next();
  if (isStaff(req.user)) return next();
  return res.sendStatus(403);
}
router.get('/deploy-script', parent, async (req, res) => {
  if (!req.user) return res.sendStatus(401);
  res.send(await scriptWithEnrollmentKey(req.user.msp_id));
});
```

## RIGHT

```typescript
function requireInstallerStaff(req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  if (!req.user) return res.sendStatus(401);
  if (!isStaff(req.user) || !req.user.msp_id) return res.sendStatus(403);
  next();
}
router.get('/deploy-script', parent, requireInstallerStaff, async (req, res) => {
  res.send(await scriptWithEnrollmentKey(req.user.msp_id));
});
```

## NOTES

Test combinations, not just individual credentials: no session, portal session,
service token alone, portal plus service token, and each allowed staff role.
Use the authenticated session MSP for tenant selection even for platform admins;
request headers/query parameters must not choose which secret is returned.

SupportForge's installer-access Express/PostgreSQL regression reproduced this
with its real parent gate and child handlers. Removing the local staff guard
makes the test fail. No production credential was used in the test. Staff
secrets also need no-store preserved through any dashboard proxy that rebuilds
responses instead of copying upstream headers.

This is runtime application authorization, not an agent configuration rule.
See also [route guards follow actual mounts](router-guard-by-mount-not-prefix.md).
