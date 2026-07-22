---
tech: supportforge
tags: [mcp, tickets, list_tickets, status-filter, solved, silent-wrong-output]
severity: high
---
# list_tickets excludes closed but still returns solved, padding any open-work view

## PROBLEM
The `list_tickets` tool description says "Closed tickets are excluded unless you pass status=closed." That reads as "finished tickets are filtered out," so it is natural to omit `status` entirely when building a queue, a daily briefing, or a workload count.

`solved` is a separate terminal status from `closed`, and it is **not** excluded. Omitting `status` returns every non-closed ticket including solved ones, so completed work silently inflates the result. The `total` field looks authoritative and nothing marks which rows are already done.

The failure is quiet and directional: a technician's "open tickets" list is padded with work they already finished, and an unassigned-queue count reports more outstanding work than exists. It only becomes visible if you happen to eyeball `solved_at` on every row.

Observed live: `assignee_email` filtered with no status returned 45 tickets; the same query with an explicit active-status list returned 4. The unassigned queue reported 5 with no filter and 4 with one.

## WRONG
```js
// "Closed are excluded, so this is my open queue." It is not.
const mine = await list_tickets({
  assignee_email: "tech@example.com",
  limit: 200,
});
// total: 45 -- mostly solved tickets from the last several weeks
```

## RIGHT
```js
// Name the active statuses explicitly. Never rely on the default.
const ACTIVE = "new,open,in progress,pending,hold";

const mine = await list_tickets({
  assignee_email: "tech@example.com",
  status: ACTIVE,
  limit: 200,
});
// total: 4 -- actually outstanding

// Valid statuses are not guesswork; describe_ticket_schema returns them:
// new, open, in progress, pending, hold, solved, closed
```

## NOTES
- `describe_ticket_schema` is the authority on valid statuses; do not hardcode a guessed list.
- `solved_at` is non-null on solved rows, so it can be used as a post-filter, but filtering server-side via `status` is cheaper and keeps `total` and `hasMore` meaningful.
- The same reasoning applies to `ticket_stats`: a status breakdown that includes solved is not a backlog.
- Related: [[get-ticket-id-vs-msp-number-collision]] -- another case where this API's convenient default resolves to something other than what the caller assumed.
