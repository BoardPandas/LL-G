---
tech: supportforge
tags: [zendesk, solved_at, tickets, sync, reporting, backlog, postgres]
severity: high
---
# Zendesk's tickets payload has no solved_at, so synced closed tickets read as open

## PROBLEM
Zendesk's `/api/v2/tickets` objects carry no `solved_at` field. The solve time
lives only in ticket metrics (`/ticket_metrics`: `solved_at`,
`full_resolution_time_in_minutes`). A sync that maps `t.solved_at` gets
`undefined` for every ticket, writes NULL, and nothing errors.

SupportForge's persona-lens Zendesk sync did exactly that, and its upsert set
`solved_at = EXCLUDED.solved_at`, so every re-sync also re-nulled any value set
elsewhere. Reporting that treats `solved_at IS NULL` as "open" then counts every
closed ticket as open: the desk analytics backlog read 4,401 open against 26
real, 4,326 of them Zendesk-synced closed tickets.

## WRONG
```ts
params.push(/* ... */ t.solved_at ? new Date(t.solved_at) : null /* always null */);
// ON CONFLICT ... DO UPDATE SET solved_at = EXCLUDED.solved_at
```
```sql
-- "open on day D" keyed on solved_at alone
AND (t.solved_at IS NULL OR t.solved_at >= d.day + interval '1 day')
```

## RIGHT
```ts
// Same rule zendesk-history-import uses: a solved/closed ticket was solved by its last update.
const solvedAt = t.solved_at ?? (t.status === 'solved' || t.status === 'closed' ? t.updated_at : null);
params.push(/* ... */ solvedAt ? new Date(solvedAt) : null);
```
```sql
AND (t.solved_at >= d.day + interval '1 day'
     OR (t.solved_at IS NULL AND COALESCE(LOWER(t.status), '') NOT IN ('closed', 'solved')))
```

## NOTES
- Detect: `SELECT count(*) FROM tickets WHERE solved_at IS NULL AND lower(status) IN ('closed','solved');` should be 0.
- Ticket merge and RMM alert auto-close had the same defect (`SET status = 'closed'` with no `solved_at`). Any writer that closes a ticket must stamp `solved_at = COALESCE(solved_at, now())`.
- Fetch `/ticket_metrics` if you need the true solve time rather than the last-update proxy.
- Fixed in supportforge-platform 3.310.3.0; migration 522 backfilled 4,555 rows from `merged_at`, else `updated_at`.
