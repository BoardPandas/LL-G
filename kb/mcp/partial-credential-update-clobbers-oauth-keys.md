---
tech: mcp
tags: [mcp, credentials, oauth, partial-update, data-loss, connector, bridge]
severity: high
---
# Partial credential update silently wipes OAuth-captured hidden keys

## PROBLEM
A connector credential often mixes two sources: fields the user pastes (e.g. an app Client ID /
Secret) and keys captured by an OAuth flow the user never types (e.g. a refresh token + company/
realm id). If the "save credentials" handler rebuilds the stored object from the visible form
fields ONLY, then any later edit of a visible field (re-pasting the Client Secret) overwrites the
whole record and DELETES the OAuth-captured keys. The connector silently loses its authorization
and every call fails, with no error at save time — the user just re-entered a valid secret.

## WRONG
```ts
// Rebuild from form fields only -> refreshToken/realmId captured by OAuth are dropped on any re-save
const clean: Record<string, string> = {};
for (const f of def.fields) {                 // fields = clientId, clientSecret, environment
  if (body.creds[f.key]?.trim()) clean[f.key] = body.creds[f.key].trim();
}
await upsertCredentials(userId, provider, clean);   // wipes hidden refreshToken + realmId
```

## RIGHT
```ts
// Merge: carry forward stored keys that are NOT user-facing fields.
const fieldKeys = new Set(def.fields.map((f) => f.key));
const existing  = (await getCredentials(userId, provider)) ?? {};
const preserved: Record<string, string> = {};
for (const [k, v] of Object.entries(existing)) if (!fieldKeys.has(k)) preserved[k] = v;
await upsertCredentials(userId, provider, { ...preserved, ...clean });
```

## NOTES
Keep OAuth-captured values OUT of the visible `fields` list (so the UI never renders/blanks them),
and treat the stored credential as a superset of the form. The OAuth callback writes the hidden
keys via a merge too (`{ ...existing, refreshToken, realmId }`). Same failure class as any
"replace-on-partial-update" bug, but especially nasty here because the lost data is an
authorization the user cannot see and did not type.
