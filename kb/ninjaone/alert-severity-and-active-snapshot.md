---
tech: ninjaone
tags: [alerts, severity, priority, notifications, polling, integration, tickets]
severity: high
---
# Alert severity is per-condition and /v2/alerts is a live snapshot, so a severity filter ships a different alert set than the email channel

## PROBLEM

Two independent traps bite anyone who replaces NinjaOne's email notification channel with `/v2/alerts` polling.

**1. `severity` is not inferable from how urgent the condition sounds, and `priority` is a separate field that does not track it.** Each condition carries its own grading, and the pairings are not intuitive:

| Condition | `sourceType` | `severity` | `priority` |
|---|---|---|---|
| Device offline 20 min ("Server Down") | `AGENT_OFFLINE` | `CRITICAL` | `HIGH` |
| Disk free <= 5% | `CONDITION_AGENT_DISK_FREE_SPACE` | `MODERATE` | `LOW` |
| No reboot in 30 days | `CONDITION_SYSTEM_UPTIME` | `NONE` | `NONE` |

A threshold written against `severity` and one written against `priority` select different sets. Guessing either way produces an integration that looks configured, runs on schedule, throws no errors, and creates nothing — or quietly creates far more than intended.

**2. `/v2/alerts` returns only currently-*active* alerts, not a history.** An alert leaves the list when its condition clears or it is reset (`POST /alert/{uid}/reset`). It is a state snapshot, not an event feed. The email channel, by contrast, emits one permanent message per firing. In a live tenant the API returned **8 active alerts** at a moment when the same conditions had produced roughly **479 emails over the preceding 60 days**.

Together these mean the API path and the email path do not carry the same population. Cutting over from email to polling — and disabling the email channel on the assumption the API now covers it — silently drops every alert that fires and clears between polls, plus everything under the chosen threshold. The failure is invisible: no error, no gap in any log, just alerts that stop arriving.

## WRONG

```ts
// Assumes "offline"/"backup failed" are low-grade and CRITICAL means catastrophe,
// so it sets a low floor to be safe -- and treats the result as an event stream.
const MIN_SEVERITY = 'MINOR';

const alerts = await ninjaGet('/v2/alerts');
for (const a of alerts) {
  if (rank(a.severity) >= rank(MIN_SEVERITY)) await createTicket(a);
}

// "The API covers alerting now" -> email notifications switched off in NinjaOne.
// Anything that fires and clears between two polls was never seen by either channel.
```

## RIGHT

```ts
// 1. Read the tenant's ACTUAL grading before picking a threshold. Never guess it.
//    GET /v2/alerts and group by severity + priority + sourceType.
const seen = await ninjaGet('/v2/alerts');
console.table(seen.map(a => ({
  sourceType: a.sourceType, severity: a.severity, priority: a.priority,
})));

// 2. Persist EVERY alert regardless of threshold, then filter only for ticketing.
//    The stored rows are what let you re-tune the floor later against real data
//    instead of re-guessing.
await upsertAllAlerts(alerts);
const ticketable = alerts.filter(a => rank(a.severity) >= rank(minSeverity));

// 3. Report the counts separately. "0 created" is ambiguous on its own.
return { fetched: alerts.length, considered: ticketable.length, created };

// 4. Keep the email channel until you have CONFIRMED tickets appearing from the
//    API path. Poll interval must be shorter than the shortest condition's
//    auto-reset, or short-lived alerts vanish between polls.
```

## NOTES

- Diagnosing "zero tickets created": `fetched`, `considered`, and `created` separate the three causes that otherwise look identical — unreachable/unscoped credentials (`fetched` 0 with an error), a threshold above anything the tenant emits (`fetched` > 0, `considered` 0), and normal dedup of already-known alerts (`considered` > 0, `created` 0). Log all three.
- `/v2/alerts` needs the `monitoring` OAuth scope. A key with only `management` returns 403, which surfaces as an empty/failed poll rather than an obvious auth error if the client swallows it.
- Alert payloads reliably carry `deviceId`; do not assume `organizationId` is present. Resolve the owning org via the device when attributing an alert to a customer, or every alert silently lands on whatever default you configured.
- Related: [oauth-authorization-code-flow.md](oauth-authorization-code-flow.md) for scope/flow setup.
- The white-labeled console domain (`<tenant>.rmmservice.com`) is also the From domain for alert email (`noreply@rmmservice.com`), which is easy to mistake for an unrelated third-party sender when auditing an inbound mail pipeline.
