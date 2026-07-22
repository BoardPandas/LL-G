---
tech: react
tags: [eslint, react-hooks, useeffect, setstate, optimistic-ui, lint-error]
severity: medium
---
# react-hooks/set-state-in-effect is an ERROR, breaking post-fetch state reconciliation

## PROBLEM
Recent `eslint-plugin-react-hooks` configs (React Compiler era, and anything extending the `recommended-latest` / flat `react-hooks` presets) ship `react-hooks/set-state-in-effect` at **error** severity, not warning. Calling a state setter synchronously in a `useEffect` body fails lint and therefore CI.

This kills a specific, very common pattern: reconciling local optimistic state after fresh server data lands. You hold optimistic overrides in a map that is merged over the fetched rows, and when a new page arrives you want the server value to win again, so you drop the stale overrides in an effect keyed on the fetched data. That effect is exactly what the rule rejects.

The trap is that the rule's own suggested remedy ("subscribe to external systems, call setState in a callback") reads as inapplicable here, so it is tempting to just add an eslint-disable. Two of the obvious rewrites are also wrong:
- Doing the reconciliation during render mutates state while rendering.
- Merging the reconciliation into the render-time `useMemo` makes the optimistic value unrepresentable, because there is then no way to distinguish "user just toggled this" from "server says this".

## WRONG
```tsx
// eslint: error  react-hooks/set-state-in-effect
useEffect(() => {
  // New rows arrived -> stale optimistic overrides must lose.
  setEdits((prev) => {
    const next = {}
    for (const [id, patch] of Object.entries(prev)) {
      const rest = { ...patch }
      delete rest.unread
      if (Object.keys(rest).length) next[id] = rest
    }
    return next
  })
}, [rows])
```

## RIGHT
```tsx
// Reconcile where the data actually arrives -- an event/callback context,
// which is what the rule is steering you toward. No effect, no lint error,
// and it runs exactly once per fetch instead of once per `rows` identity change.
const fetchRows = useCallback(async (params) => {
  const result = await api.list(params)
  clearOptimisticOverrides()   // plain setState in a callback: allowed
  return result
}, [clearOptimisticOverrides])
```

```tsx
// If the effect is genuinely unavoidable, return the SAME object when there is
// nothing to change. The rule still fires, but the cascading-render cost it
// warns about disappears, which is the argument for a scoped disable.
useEffect(() => {
  setEdits((prev) => {
    let changed = false
    // ...build `next`, setting changed = true only on a real removal
    return changed ? next : prev   // identity-stable no-op -> no re-render
  })
}, [rows])
```

## NOTES
- Severity is medium, not high: it fails loudly at lint/CI rather than producing wrong output. It earns an entry because the natural fix is an eslint-disable, which silently accepts the cascading re-render the rule exists to prevent.
- Check whether the rule is error or warning in your repo before designing around it: `npx eslint <file> -f json` and read `severity` (2 = error).
- Related: [useEffect infinite loop when state setter depends on its own state](useeffect-infinite-loop.md). That entry covers the loop; this one covers the lint rule that now forbids the shape outright.
- The functional-updater-returns-`prev` trick is worth knowing independently: React bails out of the re-render when the reducer returns the identical state object.
