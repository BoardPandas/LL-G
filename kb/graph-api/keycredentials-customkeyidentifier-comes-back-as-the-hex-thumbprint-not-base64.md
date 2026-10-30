---
tech: graph-api
tags: [entra, certificates, keycredentials, thumbprint, app-registration]
severity: high
---
# keyCredentials customKeyIdentifier comes back as the hex thumbprint, not base64 of its bytes

## PROBLEM
For certificates uploaded through the Entra portal (and by most provisioning tools), Graph returns `keyCredentials[].customKeyIdentifier` as the uppercase hex thumbprint string, so comparing it to base64 of the thumbprint bytes never matches.
The property is typed Edm.Binary, so base64 looks like the obvious encoding. The mismatch is silent: a matcher simply finds no key and reports the certificate as missing or unusable while the app authenticates fine.

## WRONG
```ts
const wanted = Buffer.from(thumbprintHex, 'hex').toString('base64');
const match = keys.find((k) => k.customKeyIdentifier === wanted); // never matches a portal upload
```

## RIGHT
```ts
function keyIdentifierMatches(id: string | undefined, thumbprintHex: string): boolean {
  if (!id) return false;
  const hex = thumbprintHex.replace(/[\s:]/g, '').toUpperCase();
  return id.toUpperCase() === hex || id === Buffer.from(hex, 'hex').toString('base64');
}
const match = keys.find((k) => keyIdentifierMatches(k.customKeyIdentifier, thumbprintHex));
```

## NOTES
Accept both forms: a key whose identifier was set to raw thumbprint bytes via an SDK does come back as base64. Normalise case and strip separators on the stored thumbprint. Verify against a live `GET /applications(appId='...')?$select=keyCredentials` before trusting either form.
