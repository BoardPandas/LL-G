---
tech: supportforge
tags: [tickets, automations, status-change, customer-email, csat, mcp, approval]
severity: high
---
# Any ticket status change runs `ticket_updated` automations, so excluding solved and closed does not stop customer email

## PROBLEM
A tool or button meant to be safe to use without an approval step (an in-chat view, a bulk action, a sync) often allows status changes but leaves out `solved` and `closed`, on the reasoning that only resolving a ticket contacts the customer.

That reasoning is wrong. Updating a ticket's status to anything runs the workspace's active `ticket_updated` automation rules for the ticket's board. A rule's actions can send the customer a satisfaction survey, send a notification email to any address the workspace configured, or set the status to solved, which then triggers the built-in survey. A rule such as "when status becomes pending, notify the requester" turns a harmless-looking status button into a customer-facing send.

Priority-only and assignee-only updates do not run automations; only a patch that carries a status does.

## WRONG
```ts
const ALLOWED = ['new', 'open', 'in progress', 'pending', 'hold'];   // "no solved, so no customer email"
if (!ALLOWED.includes(status)) return refuse();
await applyTicketUpdate(ticket, { status });                          // ticket_updated rules fire here
```

## RIGHT
```ts
// Before applying: would any active rule that matches the ticket AS IT WILL BE act outside the platform?
const rules = await loadActiveRules(mspId, 'ticket_updated', ticket.boardId);
const after = { ...ticket, status, priority: patch.priority ?? ticket.priority };
const outward = rules.filter((r) => passesFilters(r, after)).some((r) => reachesOutside(r.actions));
if (outward) return refuse('An automation rule would act on this change. Ask for it in the conversation so the normal approval applies.');
await applyTicketUpdate(ticket, { status });
```

## NOTES
- Classify actions deny-by-default: a survey, a notify email, and a status set to solved or closed reach outside; an action type the code does not recognise counts as outward.
- Reuse the automation engine's own matcher rather than copying its conditions, and evaluate against the ticket after the change, including any other field the same call sets.
- If the rules cannot be read, refuse.
- The check and the write are separate statements, so a rule added in between is not seen. That is acceptable for a safeguard and worth saying in the code.
- The same question applies to any other event that fires rules: ask what the event triggers, not what the field means.
