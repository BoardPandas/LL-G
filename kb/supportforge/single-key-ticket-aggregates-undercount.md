---
tech: supportforge
tags: [reports, analytics, sql, client_id, organization_id, dual-key, deleted_at, undercount, zendesk-import]
severity: high
---
# Ticket aggregates scoped by a single key (client_id or organization_id) silently undercount

## PROBLEM
SupportForge tickets are dual-keyed. Native tickets (created via the app/portal/email) carry `client_id` (the clients.id, shaped like `org_36856164597395`); PSA/Zendesk-imported tickets carry `organization_id` (the same id minus the `org_` prefix, e.g. `36856164597395`), often with `client_id` unset. Any report or aggregate query that scopes by only one of the two keys runs fine, returns plausible numbers, and silently misses the other population.

Observed live: the client-portal Reports page showed **Created 1 / Solved 1** while the Tickets page showed **Created 12 / Solved 13** for the same org and the same 30-day window — the report KPIs filtered `organization_id` only and missed every native ticket. Customers saw the same undercounted report in their portal.

A second compounding gap: most report queries also omitted `deleted_at IS NULL`, so soft-deleted tickets kept counting in reports while the ticket lists (which do filter it) disagreed.

## WRONG
```sql
-- Counts only Zendesk-imported tickets; native tickets are invisible.
SELECT COUNT(*) FROM tickets
WHERE organization_id = $1
  AND created_at >= NOW() - ($2::int) * INTERVAL '1 day';
```

## RIGHT
```typescript
// Derive both keys from the one id and scope every aggregate by both,
// excluding soft-deleted rows. Each row matches at most one arm of the OR,
// so nothing is double-counted.
const zendeskOrgId = clientId.startsWith('org_') ? clientId.substring(4) : clientId;
const scoped = `(client_id = $1 OR organization_id = $2) AND deleted_at IS NULL`;

await db.query(
  `SELECT COUNT(*) FROM tickets
    WHERE ${scoped}
      AND created_at >= NOW() - ($3::int) * INTERVAL '1 day'`,
  [clientId, zendeskOrgId, windowDays]
);
```

## NOTES
- `src/services/ticket-analytics.ts` was already correct and is the reference pattern; `client-reports.ts`, `client-reports-aggregate.ts`, and several report routes were not. Fixed in supportforge-platform v3.7.0.0, which also merged the client-portal Reports page into Tickets so there is a single query path.
- MSP-wide aggregates need the same treatment with IN-subqueries: `(client_id IN (SELECT id FROM clients WHERE msp_id=$1) OR organization_id IN (SELECT CASE WHEN id LIKE 'org_%' THEN substring(id from 5) ELSE id END FROM clients WHERE msp_id=$1))`.
- When two pages disagree on the same metric for the same tenant, diff their WHERE clauses first — key scoping and `deleted_at` are the usual suspects (see also list-tickets-includes-solved.md for status-default divergence).
