---
tech: nextjs
tags: [app-router, use-search-params, router-replace, query-params, client-component, state-sync, controlled-input]
severity: high
---
# A query-only router.replace() does not reliably re-render useSearchParams()

## PROBLEM
In the App Router, deriving a value straight from `useSearchParams()` and
updating it with a query-only `router.replace('?x=y')` (no pathname) yields a
control that silently does nothing. The hook does not reliably re-render with
the new value, so the derived variable never changes. Two things follow, both
invisible:

1. A controlled `<select>`/`<input>` snaps straight back to its previous value,
   because `value={derived}` is still the old one.
2. Any `useEffect` keyed on that variable never re-runs, so the data never
   reloads.

Nothing throws, nothing is logged, and the network tab shows no second request.
The address bar often does not visibly update either, so the page reads as
merely unresponsive rather than broken. The usual misdiagnosis is to go hunting
in the API or the proxy for a filter that "isn't being applied", when the new
filter value was never sent at all.

This bites any state parked in a query param -- tab switchers, filter dropdowns,
org/tenant pickers, pagination. It is easy to reintroduce: each such control is
written independently, and the pattern looks perfectly reasonable in review.

## WRONG
```tsx
'use client'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export function ServicePicker() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Purely URL-derived: this never changes after the replace() below.
  const service = searchParams.get('service') || 'huntress'
  const [rows, setRows] = useState([])

  function setService(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('service', value)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    // Never re-runs: `service` is frozen at its first value.
    void fetch(`/api/mappings?service=${service}`)
      .then((r) => r.json())
      .then((d) => setRows(d.rows))
  }, [service])

  return (
    <select value={service} onChange={(e) => setService(e.target.value)}>
      {/* picking any option snaps back and loads nothing */}
    </select>
  )
}
```

## RIGHT
```tsx
'use client'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export function ServicePicker() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlService = searchParams.get('service') || 'huntress'

  // Local state drives the UI so the switch and the refetch happen instantly.
  const [service, setService] = useState(urlService)

  // Sync back from the URL for deep links and back/forward navigation, using
  // React's "adjust state during render" pattern. Do NOT use an effect here:
  // the effect form paints the stale value for a frame and is flagged by
  // react-hooks/set-state-in-effect.
  const [prevUrlService, setPrevUrlService] = useState(urlService)
  if (urlService !== prevUrlService) {
    setPrevUrlService(urlService)
    setService(urlService)
  }

  const [rows, setRows] = useState([])

  function selectService(value: string) {
    setService(value) // <- the line that actually makes the control work
    const params = new URLSearchParams(searchParams.toString())
    params.set('service', value)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    void fetch(`/api/mappings?service=${service}`)
      .then((r) => r.json())
      .then((d) => setRows(d.rows))
  }, [service])

  return (
    <select value={service} onChange={(e) => selectService(e.target.value)}>
      {/* ... */}
    </select>
  )
}
```

## NOTES
- Swapping `router.replace` for `router.push` does not fix it; the problem is
  the read side, not the write side.
- Keep writing the URL. Local state alone breaks shareable links and the back
  button -- the sync-back block is what preserves both.
- Do not "fix" this with `window.location.search` or a hard navigation: that
  throws away client state and turns a tab switch into a full page load.
- Server-side reads are unaffected. A Server Component receiving `searchParams`
  as a prop sees the correct value; only the client hook goes stale.
- Regression test: mock `useSearchParams` to return a **frozen** value that
  never changes, then assert the control still moves and the refetch still
  fires. A mock that faithfully updates hides exactly this bug.

  ```tsx
  const frozen = new URLSearchParams('service=huntress')
  jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: jest.fn() }),
    useSearchParams: () => frozen,
  }))
  ```
- Smell to grep for when auditing a codebase:
  `const \w+ = searchParams.get(` in a `'use client'` file that also calls
  `router.replace('?`. If one control in the app has already been patched this
  way, assume the others still need it -- this recurred three times in one
  Next.js app before every query-param control was converted.
