---
tech: mcp
tags: [authorization, tenant-scope, tool-registry, joins, data-leak]
severity: high
---
# A tool exempt from per-customer scoping leaks scoped records through the labels it joins

## PROBLEM
An MCP server restricts some connections to a subset of customers (organizations,
tenants, clients). Each tool is classed in the registry: tools that read customer
records are filtered by the caller's allowed set, and tools about internal objects are
classed as unscoped and skip the filter.

A new internal object, such as a task, looks unscoped. But it can link to a scoped
record, and its read tool joins a label from that record for display: the ticket's
subject, the device's name, the contact's name. A caller restricted to customer A who
can see a shared task list then reads the subject of customer B's ticket through the
task tool. The ticket tools would have refused the same caller. No test fails, because
tests for the new tool use an unrestricted caller.

## WRONG
```ts
// Registry: exempt from the customer filter because "tasks are internal".
{ name: 'list_tasks', orgScope: 'none', handler: listTasks }

// Handler joins a label from a scoped table for every caller.
SELECT t.*, k.subject AS ticket_subject, d.hostname AS device_name
FROM tasks t
LEFT JOIN tickets k ON k.id = t.ticket_id
LEFT JOIN devices d ON d.id = t.device_id
```

## RIGHT
```ts
// Carry the restriction into the caller and apply it to every joined label.
function hideLinkedLabels(task: TaskRow, caller: Caller): TaskRow {
  if (!caller.orgRestricted) return task;
  return { ...task, ticket_subject: null, device_name: null, contact_name: null };
}
```

## NOTES
- Decide the class from what the tool can name, not from what its primary table is. Any
  tool that returns a field sourced from a scoped table needs the restriction.
- Either withhold the joined fields for restricted callers, or filter the joins by the
  caller's allowed set. Withholding is simpler and fails closed.
- Check write tools too: linking a task to a ticket by id confirms that the ticket
  exists, which is itself a leak. Return the same not-found for "missing" and "not
  yours".
- Add a test with a restricted caller for every tool that joins a scoped table.
