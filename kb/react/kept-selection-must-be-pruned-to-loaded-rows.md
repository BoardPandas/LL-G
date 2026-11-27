---
tech: react
tags: [selection, bulk-actions, table, state]
severity: high
---
# A selection kept after a bulk action reaches rows that are no longer on screen

## PROBLEM
Clearing the selection after every bulk action is annoying, so it gets changed to "keep it". But some actions remove rows from the list (set status to solved in an open-tickets queue). The ids stay in `selectedIds`, the table shows nothing selected because it only renders visible rows, and the next bulk action (priority, delete) is sent for the hidden ids. The same happens when the key that resets selection covers filters but not which list is shown, on a page that is not remounted when the query string changes.

## WRONG
```tsx
const filterKey = JSON.stringify({ filters, search, groupBy }) // not the list itself
useClearOnChange(filterKey, () => setSelectedIds(new Set()))
// after a bulk action: selection deliberately left alone
```

## RIGHT
```tsx
const listKey = JSON.stringify({ view, savedViewId, boardId, layout, filters, search })
useClearOnChange(listKey, () => setSelectedIds(new Set()))

// whenever the loaded rows change, keep only ids still listed
useEffect(() => {
  if (firstPageLoading) return
  const loaded = new Set(rows.map((r) => String(r.id)))
  setSelectedIds((prev) => {
    const next = new Set([...prev].filter((id) => loaded.has(id)))
    return next.size === prev.size ? prev : next
  })
}, [rows, firstPageLoading])
```

## NOTES
Return the previous Set when nothing was pruned, or the effect re-renders forever. Do not prune while the first page of a new list is loading, or an ordinary background refresh will look like "everything left". The count in the bulk bar and the action target must both come from the pruned set.
