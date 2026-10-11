---
tech: supportforge
tags: [saved-views, kanban, query-scope, sql, react]
severity: high
---
# Preserve saved scope and intersect every board column

## PROBLEM

A ticket queue can apply a saved definition correctly while its board requests only each column's status. Switching layouts then silently exposes unrelated tickets. Passing the saved-view ID to the board is necessary but insufficient: if the server's saved-view branch ignores the column status, every column receives the same full saved result. Both failures can look plausible when columns contain similar tickets.

## WRONG

```typescript
// Drops the selected saved scope when changing layouts.
loadColumn({ status: column.status });

// Still wrong after forwarding savedViewId: this branch discards status.
const where = savedViewId
  ? compileSavedView(savedViewId)
  : compileFilters({ status });
```

## RIGHT

```typescript
loadColumn({ savedViewId, refinements, status: column.status });

// Conceptual query composition; bind all values as SQL parameters.
const where = and(
  authorizedWorkspaceScope(actor),
  compileSavedView(savedViewId),
  compileFilters(refinements),
  statusIn(column.statusAliases),
);
```

## NOTES

- Keep workspace authorization, saved predicates, user refinements and column membership as separate intersections. Parenthesize saved match-any groups so OR cannot escape the surrounding AND.
- Apply the same composition to rows, counts and pagination. Forwarding a parameter alone does not prove the server uses it.
- Do not inherit an unrelated default system queue predicate when a saved view is selected.
- Test a saved view containing records in multiple statuses plus an out-of-scope record in each status. Assert queue/board membership, disjoint column results, aggregate counts and empty intersections after a refinement.
- In the observed SupportForge review, one saved queue contained four tickets: Open 1 and On Hold 3. The fixed board preserved that partition; an Urgent refinement reduced the queue and every column to zero. Keep privileged live mutations out of this read-only acceptance check.
- This is query behavior, not agent configuration. Regression tests belong with query compilation and board requests; no configuration guard is needed.
