---
tech: supportforge
tags: [integrations, quickbooks, oauth, timestamps, postgres, portal-sync]
severity: medium
---
# `updated_at` on a credential row is not a sync timestamp when a code path rotates the stored secret

## PROBLEM
`integration_credentials.updated_at` looks like the obvious field to show as
"last activity" on an integrations settings card, and the temptation is to reuse
it rather than add a column. It means "the stored secret changed" — which is only
the same as "a human saved it" if nothing else writes the payload.

Something else does. Intuit invalidates a QuickBooks refresh token the moment it
is exchanged, so both the connectivity test and the sync must persist the rotated
pair or leave the credential dead. That write bumps `updated_at`.

The result is a field whose meaning silently varies by service. On Huntress or
Meraki it really is the last human save. On QuickBooks it moves every time anyone
presses **Test**, so a card reading "Last updated 9:28 PM" describes a token
refresh nobody performed, and an operator debugging a stale integration
reasonably concludes someone re-entered the keys tonight. In production the
QuickBooks row's `updated_at` was hours newer than every other service's for
exactly this reason.

Generalised: any timestamp column written by more than one code path is only as
specific as its loosest writer. Before reusing one as evidence of an event, grep
for every statement that touches it.

## WRONG
```ts
// Reads as "when someone last configured this" — but not for QuickBooks.
{status?.updatedAt && <p>Last updated {new Date(status.updatedAt).toLocaleString()}</p>}
```
```ts
// ...because the test button rotates and persists, moving updated_at.
onRotate: async (rotated) => {
  await db.query(
    `UPDATE integration_credentials SET payload = $1, updated_at = now() WHERE id = $2`,
    [encryptCredentials(rotated), id]
  );
}
```

## RIGHT
```ts
// Separate column for the separate event; label the old one for what it is.
await db.query(
  `UPDATE integration_credentials
      SET last_sync_at = now(), last_sync_status = $2, last_sync_records = $3
    WHERE id = $1`,
  [credentialId, 'success', records]
);
```
```tsx
<SyncStatus state={status} />                       {/* last_sync_at */}
<p>Credentials updated {new Date(status.updatedAt).toLocaleString()}</p>
```

## NOTES
- The rotation itself is correct and must stay: a QuickBooks test that does not
  save the new refresh token leaves the row unusable, because the old one is
  already invalid at Intuit.
- Same trap in the other direction: do not add `updated_at = now()` to a sync's
  UPDATE "for consistency" — that converts a clean human-save timestamp into a
  meaningless one for every service at once.
- Related: [[connected-badge-hides-a-sync-that-never-ran]].
