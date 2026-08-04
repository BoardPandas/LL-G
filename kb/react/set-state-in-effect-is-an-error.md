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

## VERIFY
Which shapes this rule accepts is undocumented and has changed between versions, so do not trust this entry (or any summary of it) over a measurement. Drop this file into a linted source dir and run `npx eslint <file>`. It is the authority; the prose above is a description of what it produced.

```tsx
import { useCallback, useEffect, useRef, useState } from "react"

// [1] render-phase adjustment
export function C1({ org }: { org: string }) {
  const [sel, setSel] = useState<string | null>(null)
  const [prev, setPrev] = useState(org)
  if (prev !== org) { setPrev(org); setSel(null) }
  return <div>{sel}</div>
}
// [2] custom hook doing render-phase adjustment
function useResetOnChange(deps: readonly unknown[], reset: () => void) {
  const [prev, setPrev] = useState(deps)
  if (prev.length !== deps.length || prev.some((v, i) => !Object.is(v, deps[i]))) { setPrev(deps); reset() }
}
export function C2({ id }: { id: string }) {
  const [banner, setBanner] = useState<string | null>(null)
  useResetOnChange([id], () => setBanner(null))
  return <div>{banner}</div>
}
// [3] setState AFTER await, async fn declared inside the effect
export function C3({ id }: { id: string }) {
  const [x, setX] = useState(0)
  useEffect(() => { void (async () => { await fetch(`/a/${id}`); setX(1) })() }, [id])
  return <div>{x}</div>
}
// [4] setState BEFORE await, inside an effect-local async IIFE -- a REAL cascade
export function C4({ id }: { id: string }) {
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    void (async () => { setLoading(true); await fetch(`/a/${id}`); setLoading(false) })()
  }, [id])
  return <div>{String(loading)}</div>
}
// [5] identity-stable functional no-op in the effect body
export function C5({ rows }: { rows: string[] }) {
  const [edits, setEdits] = useState<Record<string, string>>({})
  useEffect(() => { setEdits((prev) => prev) }, [rows])
  return <div>{Object.keys(edits).length}</div>
}
// [6] useCallback with sync setState, called from the effect
export function C6({ id }: { id: string }) {
  const [x, setX] = useState(0)
  const reset = useCallback(() => setX(0), [])
  useEffect(() => { reset() }, [id, reset])
  return <div>{x}</div>
}
// [7] useCallback async, setState ONLY after await -- no cascade possible
export function C7({ id }: { id: string }) {
  const [x, setX] = useState(0)
  const load = useCallback(async () => { await fetch(`/a/${id}`); setX(1) }, [id])
  useEffect(() => { void load() }, [load])
  return <div>{x}</div>
}
// [8] plain async fn in component body, setState after await
export function C8({ id }: { id: string }) {
  const [x, setX] = useState(0)
  async function load() { await fetch(`/a/${id}`); setX(1) }
  useEffect(() => { void load() }, [])
  return <div>{x}</div>
}
// [9] component-scope loader called from INSIDE an effect-local async IIFE
export function C9({ id }: { id: string }) {
  const [x, setX] = useState(0)
  const load = useCallback(async () => { setX(0); await fetch(`/a/${id}`) }, [id])
  useEffect(() => { void (async () => { await load() })() }, [load])
  return <div>{x}</div>
}
// [10] ref indirection
export function C10({ id }: { id: string }) {
  const [x, setX] = useState(0)
  const load = useCallback(() => setX(0), [])
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => { void loadRef.current() }, [id])
  return <div>{x}</div>
}
```

Measured on `eslint-plugin-react-hooks@7.1.1` / `eslint-config-next@16.2.11` / `eslint@10.6.0`:

| case | shape | result |
|---|---|---|
| 1 | render-phase adjustment | passes |
| 2 | same, via a custom hook | passes |
| 3 | setState after `await`, fn declared in effect | passes |
| 4 | setState **before** `await`, effect-local IIFE | **passes** (real cascade, not reported) |
| 5 | identity-stable functional no-op | FLAGGED |
| 6 | `useCallback` sync setState, called from effect | FLAGGED |
| 7 | `useCallback` async, setState only after `await` | **FLAGGED** (false positive) |
| 8 | plain async fn in component body | FLAGGED |
| 9 | loader called from inside effect-local IIFE | passes (call is hidden, cascade unchanged) |
| 10 | `loadRef.current()` from effect | passes (call is hidden, cascade unchanged) |

Rows 4, 9 and 10 are the ones to be careful with: they pass while changing nothing about the cascade. Rows 7 and 8 are the false positives. Together they show the rule is matching lexical position, not behaviour.

## NOTES
- Severity is medium, not high: it fails loudly at lint/CI rather than producing wrong output. It earns an entry because the natural fixes (an eslint-disable, or an async-IIFE wrapper) both silently accept the cascading re-render the rule exists to prevent.
- Check whether the rule is error or warning in your repo: `npx eslint <file> -f json` and read `severity` (2 = error).
- A scoped `eslint-disable-next-line` IS defensible for a VERIFY-row-7 shape -- a shared or exported async loader that cannot move inside the effect, and whose only synchronous setState is a no-op against the initial state (e.g. `setLoading(true)` when `loading` already starts `true`). State that reasoning in the comment, so the next reader knows it was measured rather than silenced.
- The identity-stable functional-updater trick (`return changed ? next : prev`) does NOT satisfy this rule -- VERIFY row 5 still reports. It remains useful on its own terms, because React bails out of the re-render when the reducer returns the identical state object, but it is not a lint fix.
- VERIFY rows 9 and 10 (IIFE wrapper, ref indirection) are the two tempting escape hatches. Both pass, and both leave the cascade exactly where it was. If you use one, you have silenced the rule, not satisfied it -- prefer a disable with a reason, which is at least honest about what happened.
- Related: [useEffect infinite loop when state setter depends on its own state](useeffect-infinite-loop.md). That entry covers the loop; this one covers the lint rule that now forbids the shape outright.
