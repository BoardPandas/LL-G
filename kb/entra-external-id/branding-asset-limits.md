---
tech: entra-external-id
tags: [entra, branding, company-branding, images, sign-in-page, logo, favicon]
severity: low
---
# Company Branding image slots have strict size limits and confusing roles

## PROBLEM
Entra Company Branding rejects uploads that exceed per-slot pixel/file-size limits, with
terse errors, and the slots' roles are non-obvious: uploading the "square logo" does NOT
put a logo on the sign-in card; the card's header (which otherwise shows the plain tenant
name) is the BANNER logo slot. Marketing-grade source images fail every limit.

## WRONG
```text
- Upload a 2000px 500KB hero photo as the background: rejected (max 1920x1080, 300KB).
- Upload the org crest as favicon: rejected (needs 32x32, under 5KB).
- Upload the square logo and expect it on the sign-in card: it isn't; the card still
  shows the plain tenant-name text.
```

## RIGHT
```text
Pre-size every asset before touching the portal:
- Background image: max 1920x1080 AND under 300KB (JPEG quality ~75 usually lands it)
- Banner logo (the sign-in card header): 245x36, transparent PNG; for a square crest,
  compose crest + wordmark into one horizontal image
- Square logo (light + dark): 240x240, under 50KB; posterizing color channels (keeping
  alpha) shrinks flat-color logos well under the cap
- Favicon: 32x32, under 5KB PNG
Sign-in pages cache branding; verify in a fresh private window.
```

## NOTES
The page background color shows while the background image loads or if it fails; pick a
neutral/brand color, not a placeholder. The background image is center-cropped to the
viewport, so key content at the image edges gets clipped on tall screens.
