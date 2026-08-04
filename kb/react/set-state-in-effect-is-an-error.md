---
tech: react
tags: [eslint, react-hooks, useeffect, setstate, optimistic-ui, lint-error, false-positive, render-phase-update]
severity: medium
---
# react-hooks/set-state-in-effect is an ERROR, breaking post-fetch state reconciliation

## PROBLEM
Recent `eslint-plugin-react-hooks` configs (React Compiler era, and anything extending the `recommended-latest` / flat `react-hooks` presets) ship `react-hooks/set-state-in-effect` at **error** severity, not warning. Calling a state setter synchronously in a `useEffect` body fails lint and therefore CI.

This kills a specific, very common pattern: reconciling local optimistic state after fresh server data lands. You hold optimistic overrides in a map that is merged over the fetched rows, and when a new page arrives you want the server value to win again, so you drop the stale overrides in an effect keyed on the fetched data. That effect is exactly what the rule rejects.

Two things make this much worse than "rewrite one effect", and both are only obvious after you have run the rule across a whole codebase:

**1. The rule matches on lexical position, not on whether a cascade can actually happen.** It flags a call to ANY component-scope function whose body contains a `setState`, when that function is called from an effect body -- even when every `setState` in it happens after an `await`, so no synchronous cascading render exists. A `useCallback` async loader that only sets state after its fetch resolves is a false positive. Meanwhile, a function *declared inside the effect* is accepted even when it sets state synchronously before its first `await`, which is a real cascade. So the rule both over- and under-reports, and wrapping the offending call in an `async` IIFE silences it without changing behaviour at all. That wrapper is rule-gaming, not a fix.

**2. "Don't set state during render" is not the right lesson.** Adjusting state during render is a documented, supported React pattern ("You Might Not Need an Effect" -> adjusting state when a prop changes), and it is the correct replacement for the whole `useEffect(() => setX(initial), [dep])` reset family. React re-runs the component immediately and discards the intermediate render, so the stale value is never committed -- strictly better than the effect, which paints the stale value for a frame. The rule accepts it. It is only the *optimistic-override* case below where render-phase adjustment does not help, because there you cannot distinguish "user just toggled this" from "server says this".

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

```tsx
// Also WRONG: silencing the rule by moving the same synchronous setState into
// an async IIFE. setLoading(true) still runs synchronously when the effect
// executes -- the cascade the rule exists to catch is untouched. The rule only
// stops reporting because the call is no longer lexically in the effect body.
useEffect(() => {
  void (async () => {
    setLoading(true)
    await load()
  })()
}, [dep])
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
// For the reset-on-dep-change family, adjust state during render. Passes the
// rule, and never commits the stale value. Worth extracting once if you have
// many of them; take a dep ARRAY so converted effects fire on exactly the
// changes they did before, including object-reference deps.
function useResetOnChange(deps: readonly unknown[], reset: () => void): void {
  const [prev, setPrev] = useState(deps)
  if (prev.length !== deps.length || prev.some((v, i) => !Object.is(v, deps[i]))) {
    setPrev(deps)
    reset()
  }
}

// useEffect(() => setBanner(null), [ticketId])   ->
useResetOnChange([ticketId], () => setBanner(null))
```

```tsx
// For fetch-on-mount effects, the honest fix is usually that the initial state
// is already correct. If `loading` starts true, the mount path never needed
// setLoading(true) at all, and the loader can move inside the effect.
const [loading, setLoading] = useState(true)

useEffect(() => {
  let cancelled = false
  void (async () => {
    try {
      const data = await api.get(id)
      if (!cancelled) setRows(data)
    } finally {
      if (!cancelled) setLoading(false)   // after an await: allowed
    }
  })()
  return () => { cancelled = true }
}, [id])

// Re-arm the spinner on a later dep change, where initial state no longer covers it.
useResetOnChange([id], () => setLoading(true))
```

## NOTES
- Verified against `eslint-plugin-react-hooks@7.1.1` (via `eslint-config-next@16.2.11`, `eslint@10.6.0`). Probe the exact behaviour before designing around it -- write a scratch file with each candidate shape and lint it. Which shapes pass is not documented and has changed between versions.
- Severity is medium, not high: it fails loudly at lint/CI rather than producing wrong output. It earns an entry because the natural fixes (an eslint-disable, or an async-IIFE wrapper) both silently accept the cascading re-render the rule exists to prevent.
- Check whether the rule is error or warning in your repo: `npx eslint <file> -f json` and read `severity` (2 = error).
- A scoped `eslint-disable-next-line` IS defensible for case 1 above -- a shared/exported async loader that cannot move inside the effect and whose only synchronous setState is a no-op against the initial state. Say that in the comment, so the next reader knows it was reasoned about rather than silenced.
- The identity-stable functional-updater trick (`return changed ? next : prev`) does NOT satisfy this rule -- it still reports. It remains useful on its own terms, because React bails out of the re-render when the reducer returns the identical state object, but it is not a lint fix.
- The rule also cannot see through a ref (`loadRef.current()`). Same category as the IIFE wrapper: it hides the call rather than removing the cascade.
- Related: [useEffect infinite loop when state setter depends on its own state](useeffect-infinite-loop.md). That entry covers the loop; this one covers the lint rule that now forbids the shape outright.
