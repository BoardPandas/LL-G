---
tech: typescript
tags: [drizzle-orm, postgres, audit-tables, foreign-keys, schema-design, lifecycle, multi-tenant]
severity: medium
---
# Audit table FK to "primary" entity blocks pre-activation events

## PROBLEM

When designing an audit/event-log table that holds `entity_id NOT NULL REFERENCES entity(id)`, you cannot record events that happen BEFORE the entity row exists. This is fine for entities created in one shot, but it silently boxes you in once the feature grows a request -> approve -> activate lifecycle.

Concretely: you ship `support_access_audit(grant_id NOT NULL FK)` for a "Platform admin → partner data" support-access feature. Months later you add a break-glass flow where a Platform Admin requests access, a co-signer approves, and only THEN the grant row gets created. You want audit rows for `requested`, `email_dispatched`, `co_signer_notified`, but the FK rejects every insert because no `grant_id` exists yet.

The fix is a schema migration plus a `WHERE grant_id IS NULL` predicate sprawl, both of which are avoidable if the design accounts for pre-entity events upfront.

## WRONG

```ts
// Audit table forces every event to attach to a created grant
export const supportAccessAudit = pgTable("support_access_audit", {
  id: id(),
  grantId: text("grant_id")
    .notNull()                                // ← blocks pre-activation events
    .references(() => supportAccessGrants.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  actorUserId: text("actor_user_id").notNull(),
  ts: timestamp("ts").notNull().defaultNow(),
});

// In the request handler:
await db.insert(supportAccessAudit).values({
  grantId: ???,                               // grant doesn't exist yet -- FK violation
  action: "break_glass.requested",
  actorUserId: requester.id,
});
```

## RIGHT

Pick one of three patterns up front, based on whether pre-entity events need first-class auditability.

```ts
// Option A — pre-events go to a separate channel (e.g. app_logs via Pino).
//            Audit table only ever sees post-activation rows.
log.info(
  { action: "break_glass.requested", requesterId, partnerId, requestId },
  "Break-glass requested",
);
// supportAccessAudit row is written when the grant is created on co-sign.

// Option B — make the FK nullable. Pre-events have grant_id = NULL.
export const supportAccessAudit = pgTable("support_access_audit", {
  id: id(),
  grantId: text("grant_id")                   // nullable
    .references(() => supportAccessGrants.id, { onDelete: "set null" }),
  requestId: text("request_id"),              // optional pre-activation key
  action: text("action").notNull(),
  // ...
});

// Option C — split tables. Requests and audit have independent lifecycles.
export const supportAccessRequests = pgTable("support_access_requests", { /* ... */ });
export const supportAccessAudit    = pgTable("support_access_audit",    {
  id: id(),
  grantId: text("grant_id").notNull().references(() => supportAccessGrants.id),
  // ...
});
```

## NOTES

- Decision rule: if the pre-activation window is short and the events are "infrastructure-level" (an email was sent, a token was minted), Option A (Pino → `app_logs`) is the lightest. If pre-events have legal or compliance significance (DSAR, Legal Hold, break-glass requests), prefer Option B or C so they are queryable alongside post-activation events.
- Option B's downside: every read query needs `WHERE grant_id IS NULL` or `IS NOT NULL` predicates, plus partial indexes for performance. The predicate sprawl tends to leak into ad-hoc reports.
- Option C's downside: two tables to keep in sync, and joins for "show me the full timeline of this access" queries. Pays off when the request itself has a rich state machine (status, reviewers, expiry).
- Retrofitting later costs a migration (`ALTER COLUMN ... DROP NOT NULL`) plus updating every query that assumed the FK was set. Cheaper to decide on day one.
- Real incident: Vigilis Phase 2i (break-glass). `support_access_audit.grantId NOT NULL` blocked the request-time audit row; the team shipped Option A (Pino logging with `action: "break_glass.requested"`) and gated the actual audit insert behind co-signer activation. The HMAC-signed token carried request state across the pre-activation window.
- Related: similar pattern shows up with `invoice_line_items.invoice_id NOT NULL` blocking parsing-stage events, and `subscription_events.subscription_id NOT NULL` blocking trial-creation audit.
