# oauth2PermissionGrants writes need DelegatedPermissionGrant.ReadWrite.All

**Severity**: HIGH
**Tags**: graph-api, admin-consent, oauth2PermissionGrants, app-permissions

## Problem

`POST /oauth2PermissionGrants` (granting tenant-wide or per-user delegated consent on behalf of another service principal) returns `403 Authorization_RequestDenied` even when the calling app has `Directory.ReadWrite.All`.

Microsoft documentation still lists `Directory.ReadWrite.All` as a permitted scope for this endpoint, but in practice (observed in production tenants in 2026) only `DelegatedPermissionGrant.ReadWrite.All` is honored for app-credentialed writes. `Directory.ReadWrite.All` is sufficient to **read** existing oauth2PermissionGrants but not to **create or modify** them.

## Symptom

```
POST https://graph.microsoft.com/v1.0/oauth2PermissionGrants
{
  "error": {
    "code": "Authorization_RequestDenied",
    "message": "Insufficient privileges to complete the operation."
  }
}
```

The error message does not name the missing scope, which makes diagnosis slow if you trust the public docs.

## Fix

Add `DelegatedPermissionGrant.ReadWrite.All` (application permission) to the calling app registration and grant admin consent. After ~15-30s propagation, disconnect, reconnect (token must be reissued to carry the new scope), retry the POST.

## Why this matters

This blocks any "grant tenant-wide consent for app X" automation that uses cert-auth on a managed-tenant app, including post-onboarding scripts that approve gallery apps without forcing a Global Admin browser flow.

## Related

- `permission-propagation.md` -- reconnect after consent, do not reuse cached tokens.
- `403-admin-consent.md` -- distinguish between "permission missing from app" and "admin consent never granted" before assuming the symptom is propagation.
