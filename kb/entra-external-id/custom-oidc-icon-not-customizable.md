---
tech: entra-external-id
tags: [entra, external-id, ciam, branding, custom-css, oidc, sign-in-page]
severity: medium
---
# Custom OIDC provider icons can't be changed, and custom CSS is gone for new tenants

## PROBLEM
Any custom OIDC identity provider button on the External ID sign-in page shows a generic
blue-circle icon; built-ins (Google, Facebook, Apple) get their real logos. There is no
supported setting to replace the icon (confirmed Microsoft limitation). The historical
escape hatch, uploading custom CSS via Company Branding, is unavailable for tenants
created after January 5, 2026, so on any new external tenant you cannot style your way
around it either. Teams burn hours hunting for a setting that does not exist.

## WRONG
```text
- Search the identity provider config / app registration branding for an icon upload.
- Plan to fix it with Company Branding > Custom CSS on a tenant created in 2026+.
Neither path exists.
```

## RIGHT
```text
Accept the icon and control what you can:
- The button text comes from the provider's Display name; rename it (e.g. "Microsoft")
  so the label reads cleanly even with the generic icon.
- Present built-in providers (Google) prominently; note the icon gap to stakeholders
  as a Microsoft platform limitation, not a design defect.
- Tenants created BEFORE 2026-01-05 keep custom CSS and can hide/replace the icon there.
```

## NOTES
Related: the "Sign in to access X" subtitle is the app registration's display name, and
the plain-text tenant name in the card header is replaced by uploading a Banner logo
(245x36), not the square logo. Per-language string overrides exist (User flows >
Languages > download defaults JSON) but not every string is exposed.
