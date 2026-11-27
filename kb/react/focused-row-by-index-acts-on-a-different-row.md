---
tech: react
tags: [keyboard, table, virtualization, polling, focus]
severity: high
---
# A keyboard action resolved by focused index acts on a different row after the list changes

## PROBLEM
A list keeps `focusIdx` and a window key handler does `const row = visibleRows[focusIdx]`. The index only moves on keyboard navigation. A background poll that prepends a row, or a sort change, puts a different record at that index, and a destructive shortcut (solve, assign) lands on a record the user never looked at. With a virtualized list there is a second trap: the row can be mounted in the overscan window but scrolled out of view, and the shortcut still acts on it.

## WRONG
```tsx
const onKey = (e) => {
  const focused = visibleRows[focusIdx]
  if (e.key === 'e' && focused) solve(focused.id)
}
```

## RIGHT
```tsx
const focusedId = useRef(null)
// set focusedId whenever focus moves; re-derive the index when rows change
useEffect(() => {
  if (focusedId.current == null) return
  const i = rows.findIndex((r) => String(r.id) === focusedId.current)
  setFocusIdx(i) // -1 clears the focus instead of sliding to a neighbour
  if (i === -1) focusedId.current = null
}, [rows])

const inView = (id) => {
  const el = document.querySelector(`[data-row-id="${id}"]`)
  if (!el) return false // unmounted counts as not visible
  const r = el.getBoundingClientRect(), box = scrollBox(el).getBoundingClientRect()
  const mid = r.top + r.height / 2
  return mid >= box.top && mid <= box.bottom
}
if (e.key === 'e' && focusedId.current && inView(focusedId.current)) solve(focusedId.current)
```

## NOTES
Add a per-row in-flight guard as well: a double press otherwise fires two writes. Clearing the focus when the id disappears also handles switching to another list on a page that does not remount.
