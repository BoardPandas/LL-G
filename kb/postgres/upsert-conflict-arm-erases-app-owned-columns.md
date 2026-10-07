---
tech: postgres
tags: [upsert, on-conflict, do-update, excluded, webhook, sync, mirror, data-loss, kysely]
severity: high
---
# An upsert's DO UPDATE arm erases app-owned columns on a mirrored table, seconds after they are written

## PROBLEM

A table mirrors records from an upstream system (issues from a tracker, objects
from a payments API, contacts from a CRM). Webhook deliveries and polling resyncs
write it with `INSERT ... ON CONFLICT DO UPDATE SET col = EXCLUDED.col`.

Later the application adds columns of its OWN to that table -- who submitted the
record in-app, an approval decision, an internal category -- and writes them at
intake. If the conflict arm refreshes those columns from `EXCLUDED` (or a helper
spreads "every column the insert writes" into the update), the next delivery
overwrites them with whatever the upstream payload carries. Upstream knows nothing
about app-owned data, so that is usually NULL, or the integration's bot identity.

The timing makes it look like a write-side bug: the record is created through the
upstream API at intake, and the upstream's own "created" webhook arrives seconds
later and replays the row. Intake is correct; the value is gone anyway. The row is
still present, nothing errors, and only that one field is wrong -- permanently.

A common trigger: the upstream "author" of anything created through an app/bot
integration IS the bot, so the real submitter needs an app-owned column -- which
the existing conflict arm then wipes.

## WRONG

```sql
-- One statement serves both intake and webhook replays.
INSERT INTO issue (external_id, title, state, submitted_by_user_id)
VALUES ($1, $2, $3, $4)            -- webhook path passes NULL for $4
ON CONFLICT (external_id) DO UPDATE SET
  title                = EXCLUDED.title,
  state                = EXCLUDED.state,
  submitted_by_user_id = EXCLUDED.submitted_by_user_id;  -- erases the intake value
```

## RIGHT

```sql
-- Refresh ONLY the columns the upstream system owns. App-owned columns are
-- insert-only: written once, never named in the conflict arm.
INSERT INTO issue (external_id, title, state, submitted_by_user_id)
VALUES ($1, $2, $3, $4)
ON CONFLICT (external_id) DO UPDATE SET
  title = EXCLUDED.title,
  state = EXCLUDED.state;
  -- submitted_by_user_id, approval_status, internal_category: deliberately absent
```

```ts
// Regression test: intake, then replay the upstream delivery, then assert.
await intake({ externalId: 'X-1', submittedBy: 'user-42' });
await upsertFromUpstream({ externalId: 'X-1', title: 'edited', submittedBy: null });
expect((await getIssue('X-1')).submitted_by_user_id).toBe('user-42');
```

## NOTES

- Check the conflict arm BEFORE adding a column to any table an upstream sync
  writes, not after the field goes missing in production.
- If a later delivery may legitimately fill a value the app left empty, use
  `col = COALESCE(issue.col, EXCLUDED.col)` -- never bare `EXCLUDED.col`.
- A stronger guard than the replay test: compile the upsert and assert that no
  app-owned column name appears in its `do update set` clause, so a new column is
  caught even when no test exercises it.
- Comment the conflict arm with which columns are upstream-owned and why the rest
  are absent; the next person to add a column reads that list.
