---
tech: supportforge
tags: [portal-sync, integrations, observability, settings-ui, notion, silent-failure]
severity: high
---
# A "Connected" badge that only proves a credential row exists hides a sync that has never run

## PROBLEM
The integrations settings tab derived each card's status from one fact: does a
row exist in `integration_credentials` for this service? If yes, the card
rendered a green **Connected** badge and "Last updated <date>".

Neither signal says anything about the sync. `updated_at` is when the *secret*
was saved, and the badge is a `NOT NULL` check. A credential can be present,
valid, and never once consumed.

That is exactly what happened to Notion. The scheduler filtered to
*client-scoped* credentials (`client_id IS NOT NULL`), while the settings card
hard-coded `client_id: null` on save. The two scopes never intersected, so every
run matched zero rows and completed successfully with "0 record(s) upserted".
The card stayed green for months. `notion_pages` in production held 154 pages
last synced four weeks before anyone noticed, and the portal Docs section served
them as current.

The scope mismatch is the proximate bug; the reason it survived is that no
surface anywhere distinguished "synced fine" from "never ran". A success path
that legitimately processes zero rows is indistinguishable from a broken filter
unless you record per-credential outcomes.

Note also that a *global* task-run table cannot substitute here. `task_runs` is
keyed by `task_key` with no `msp_id`, so it records one row per service per run
across all tenants — with a single MSP configured it looks correct by accident,
and with two it shows one MSP a timestamp produced by a run over another's data.

## WRONG
```tsx
// Card status: does a row exist? That is all this proves.
const connected = !!status
<Badge variant={connected ? 'sage' : 'secondary'}>
  {connected ? 'Connected' : 'Not connected'}
</Badge>
{status?.updatedAt && <p>Last updated {new Date(status.updatedAt).toLocaleString()}</p>}
```
```ts
// ...while the scheduler silently matches nothing.
const creds = await getCredentialsForService('notion');
const clientScoped = creds.filter(c => c.clientId !== null);  // the card saves null
await parallelLimit(clientScoped.map(c => () => syncNotionForClient(c)), 3);
// "Notion sync completed: 0 record(s) upserted" — forever, and green in the UI.
```

## RIGHT
```sql
-- Record the outcome on the credential row itself: that is the grain the syncs
-- iterate, so it is per (msp, service, client, tenant) rather than global.
ALTER TABLE integration_credentials
  ADD COLUMN IF NOT EXISTS last_sync_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_status  TEXT,       -- success | failed
  ADD COLUMN IF NOT EXISTS last_sync_error   TEXT,
  ADD COLUMN IF NOT EXISTS last_sync_records INTEGER,
  ADD COLUMN IF NOT EXISTS next_sync_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_started_at   TIMESTAMPTZ;
```
```ts
// One wrapper records both outcomes, so a failure lands on the row, not just a log line.
export async function runTrackedSync(cred, service, syncFn, nextSyncAt) {
  await markSyncStarted(cred.id);
  try {
    const records = await syncFn(cred);
    await markSyncResult(cred.id, { status: 'success', records, nextSyncAt });
    return records;
  } catch (error) {
    await markSyncResult(cred.id, { status: 'failed', error: error.message, nextSyncAt });
    return 0;   // one credential's failure must not stop the fan-out
  }
}
```
```tsx
// NULL last_sync_at is a real state and must read as one.
{lastSyncAt ? <>Synced {relativeTime(lastSyncAt)}</> : <span>Never synced</span>}
```

## NOTES
- The new columns are NULL for every pre-existing row. Render them; never build
  a `WHERE`/`ORDER BY` predicate on them — see
  `kb/postgres/filter-on-empty-column-matches-nothing.md`.
- "0 records" is the signature to watch for. A sync that returns a plausible zero
  on every single run has almost certainly matched nothing, not found nothing.
- Where a sync must run over a group of credentials at once, stamp the outcome on
  every row in the group but leave the record count NULL — one shared total
  written onto each row reads as if each had synced that many.
- Related: [[vendor-without-per-record-key-cannot-fan-out]],
  [[credential-updated-at-is-not-a-sync-timestamp]].
