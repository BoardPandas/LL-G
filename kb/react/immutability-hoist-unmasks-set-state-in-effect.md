---
tech: react
tags: [eslint, react-hooks, immutability, set-state-in-effect, useeffect, usecallback, lint, hoisting]
severity: medium
---
# Clearing react-hooks/immutability by hoisting a fetcher unmasks set-state-in-effect

## PROBLEM

`react-hooks/immutability` errors with "Cannot access variable before it is declared" when an effect calls a `const` arrow function declared further down the component. The documented fix is to move the declaration above the effect and wrap it in `useCallback`.

The non-obvious part: that fix can make the file lint *worse*, not better. While the function was used-before-declared, `react-hooks/set-state-in-effect` could not resolve the binding, so it never fired. Hoisting the declaration is exactly what lets it resolve — and it then reports at error severity on a line you did not touch.

So a two-error file becomes a one-error file after a fix that looks complete, and a verification step of "did the reported errors go away" passes while the file is still failing lint. Budget for the second rule whenever you fix the first.

The rule matches lexically (see `set-state-in-effect-is-an-error.md`): it flags any effect-called component function whose body contains a `setState`, even when every update happens after an `await`. Two restructurings that look like they should satisfy it do not:

- Moving `setLoading(false)` out of a `finally` block into the `try` tail and the `catch`. Still flagged.
- Deleting a genuinely synchronous `setState` from before the first `await`. Still flagged (though this one is worth doing on its own merits).

It also reports only once per effect, at the *first* offending call, so a second fetcher in the same effect stays invisible until you silence the first — do not read the single report as "only this one function is a problem."

## WRONG

```tsx
// Before: immutability errors on both calls.
useEffect(() => {
  void fetchData();          // error: accessed before it is declared
  void fetchStatus();        // error: accessed before it is declared
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

const fetchStatus = async () => { /* ... setStatus(...) after await */ };
const fetchData = async () => { /* ... setData(...) after await */ };
```

```tsx
// The "fix" that looks done but is not: immutability is gone, and
// set-state-in-effect now fires at 'void fetchData()' for the first time.
const fetchData = useCallback(async () => {
  setLoading(true);          // real violation: synchronous, before any await
  const res = await fetch(url);
  setData(await res.json());
}, []);

useEffect(() => {
  void fetchData();          // error: react-hooks/set-state-in-effect
}, [fetchData]);
```

## RIGHT

```tsx
const fetchStatus = useCallback(async () => {
  const res = await fetch(statusUrl);
  if (res.ok) setStatus((await res.json()).connected === true);
}, [onStatusChange]);

// `loading` already initializes to true and this only runs on mount, so the
// synchronous setLoading(true) was a no-op that cost a render inside the effect.
const fetchData = useCallback(async () => {
  try {
    const res = await fetch(url);
    if (res.ok) setData(await res.json());
  } finally {
    setLoading(false);
  }
}, []);

useEffect(() => {
  // set-state-in-effect matches lexically: it flags any effect-called function
  // whose body contains a setState. Both fetchers only update state after an
  // await, so no state is set synchronously during this effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  void fetchData();
  if (kind === 'zendesk') void fetchStatus();
// kind is read for its mount-time value only; must not re-run on switch.
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [fetchData, fetchStatus]);
```

## NOTES

- Verify with a full lint run of the file, never by checking that the originally-reported line numbers are clean. The replacement error lands on a different rule and often a different line.
- Adding the hoisted callbacks to the dependency array is only behavior-preserving if they are actually stable. Check the call site: a parent passing an inline arrow for a prop that a `useCallback` depends on changes its identity every render and converts a mount-only effect into a per-render refetch. A prop that is never passed is `undefined` and therefore stable.
- Keep the pre-existing `exhaustive-deps` disable when the effect deliberately reads a value for its mount-time snapshot. Listing that value would change when the effect re-runs, which is a behavior change smuggled in under a lint fix.
- Do not reach for the async-IIFE shape to silence the rule. `set-state-in-effect-is-an-error.md` records that as a false *negative* — it hides genuinely cascading synchronous updates while this after-await case is the one being suppressed.
- Related: `set-state-in-effect-is-an-error.md` (the lexical-matching behavior itself), `useeffect-infinite-loop.md`.
