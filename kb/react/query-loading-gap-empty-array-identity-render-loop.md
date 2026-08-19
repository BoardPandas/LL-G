---
tech: react
tags: [tanstack-query, tanstack-table, useReactTable, render-loop, referential-identity, useMemo, browser-freeze]
severity: high
---
# `data ?? []` during a query's loading gap hard-freezes the tab via an uncommitted render loop

## PROBLEM

When a TanStack Query key changes, the new query has no cached data, so `query.data` is `undefined` until the request lands. Code that writes `const rows = query.data?.rows ?? []` in that gap allocates a **brand-new array on every render**.

On its own that is merely wasteful. It becomes a hard freeze when the identity reaches a consumer that treats `data` as a change signal -- `useReactTable` is the one to watch. The grid sees "new" data every pass and re-renders, which produces another new array, which is new data again. The loop never terminates and never commits a frame.

It does not look like a React bug, because none of the usual symptoms appear:

- **React never throws.** "Maximum update depth exceeded" (limit 50) and "Too many re-renders" (limit 25) both guard *nested update* loops. This one loops inside the render pass, so neither guard fires.
- **Nothing is logged.** No warning, no error, no failed request.
- **No DOM work happens at all.** The render phase calls `React.createElement`, never `document.createElement`, so DOM-level instrumentation and MutationObservers stay silent.
- **The tab is unrecoverable.** The renderer never yields, so input is not dispatched, timers stop, and Chrome cannot even navigate away -- a subsequent `location.assign` appears to succeed while the old document is still stuck.
- **Screenshots keep working**, because compositing runs off-thread and re-serves the last painted frame. This is the trap: the page looks alive and merely "slow to update", so it reads as a hung network request rather than a spun main thread.

The trigger is any action that changes the records query key -- switching a saved view, applying a filter, changing a sort. Views whose filter collapses to a stable primitive (`undefined`) are safe purely by luck, which makes the bug look view-specific when it is not.

## WRONG

```tsx
// Every `?? []` here mints a fresh identity while the query is pending.
const attributes = objectQuery.data?.attributes ?? [];
const rawRecords = recordsQuery.data?.data ?? [];

// ...and helpers that allocate per call feed the query key itself.
function filterForView(slug: string) {
  return slug === "unlinked" ? { company: null } : undefined; // new object each call
}
const viewFilter = filterForView(selectedView); // not memoized

const recordsQuery = useQuery({
  queryKey: ["records", "people", viewFilter],
  queryFn: () => listRecords("people", viewFilter),
});

const filtered = useMemo(() => rawRecords.filter(matches), [rawRecords]); // dep churns
const toggleAll = useCallback(() => { /* ... */ }, [filtered]);           // churns
const columns = useMemo(() => buildColumns({ toggleAll }), [toggleAll]);  // churns

const table = useReactTable({ data: filtered, columns, getCoreRowModel: getCoreRowModel() });
// -> new `data` AND new `columns` every render -> unbounded render loop, frozen tab
```

## RIGHT

Hoist the empty fallbacks to module constants, and memoize every value that feeds a query key or the grid.

```tsx
// Module scope: one identity for the whole app.
const NO_ATTRIBUTES: AttributeDTO[] = [];
const NO_RECORDS: RecordDTO[] = [];

const attributes = objectQuery.data?.attributes ?? NO_ATTRIBUTES;
const rawRecords = recordsQuery.data?.data ?? NO_RECORDS;

const viewFilter = useMemo(() => filterForView(selectedView), [selectedView]);

const recordsQuery = useQuery({
  queryKey: ["records", "people", viewFilter],
  queryFn: () => listRecords("people", viewFilter),
});

const filtered = useMemo(() => rawRecords.filter(matches), [rawRecords]); // now stable
const toggleAll = useCallback(() => { /* ... */ }, [filtered]);           // now stable
const columns = useMemo(() => buildColumns({ toggleAll }), [toggleAll]);  // now stable

const table = useReactTable({ data: filtered, columns, getCoreRowModel: getCoreRowModel() });
```

Rule of thumb: `?? []` and `?? {}` are safe in a leaf that only reads the value. They are a hazard the moment the value crosses into a query key, a `useMemo`/`useCallback` dependency, or a library that compares by reference.

## NOTES

- **The grid is the amplifier, not the cause.** A sibling screen with the identical `?? []` and the identical key transition survived, because it rendered rows directly instead of driving `useReactTable`. If one screen freezes and another does not, diff what consumes the row array before you diff the data.
- **Unit tests will not catch this.** Reproduction attempts under jsdom + React Testing Library all settled in one render -- `act()` flushes synchronously and does not exercise the concurrent render path. It reproduces only in a real browser. Do not treat a green test suite as evidence the loop is gone; verify in a browser.
- **Getting a stack out of a frozen renderer:** DevTools cannot attach, and DOM-level guards never fire (render phase does no DOM work). What works is monkey-patching a hot *JS* primitive with a call counter that throws past a threshold, reset on an interval so normal use never trips it:

  ```js
  let n = 0;
  const orig = Object.keys;
  Object.keys = function () {
    if (++n > 4_000_000) { console.error(new Error("LOOPGUARD").stack); throw new Error("LOOPGUARD"); }
    return orig.apply(this, arguments);
  };
  setInterval(() => { n = 0; }, 300);
  ```

  Throwing breaks the loop and the stack names the looping component. `Object.keys` is a good probe when query keys are involved (TanStack Query hashes keys through it); `Array.prototype.map`/`filter` work more generally.
- **Chrome cannot unload a frozen renderer.** Once it locks, later navigations in that tab silently do nothing, so subsequent "the whole app is broken" observations are an artifact. Close the tab and open a fresh one between reproduction attempts, or you will chase ghosts.
- Related: [useEffect infinite loop when state setter depends on its own state](useeffect-infinite-loop.md) is the *other* React loop -- that one React catches and throws on; this one it does not.
- Found in an AI-first CRM's People screen (TanStack Query 5.101 + TanStack Table 8 + React 19): clicking a saved view whose filter was `{ company: null }`, or applying any ad-hoc filter, froze the tab outright.
