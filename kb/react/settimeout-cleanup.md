---
tech: react
tags: [useEffect, setTimeout, cleanup, unmount, memory-leak]
severity: medium
---
# setTimeout in useEffect without cleanup fires after unmount

## PROBLEM

A `setTimeout` scheduled inside a `useEffect` will fire even after the component unmounts. If the callback updates state or calls a parent callback, React warns about state updates on unmounted components. In concurrent mode, this can cause subtle bugs where a transition completes on a stale component tree.

## WRONG

```tsx
useEffect(() => {
  async function finalize() {
    await saveData();
    setSaving(false);
    setTimeout(onComplete, 1500); // fires even if component unmounts
  }
  finalize();
}, [onComplete]);
```

## RIGHT

```tsx
useEffect(() => {
  let timeoutId: ReturnType<typeof setTimeout>;

  async function finalize() {
    await saveData();
    setSaving(false);
    timeoutId = setTimeout(onComplete, 1500);
  }
  finalize();

  return () => clearTimeout(timeoutId);
}, [onComplete]);
```

## NOTES

- Same pattern applies to `setInterval` -- always return a cleanup function.
- If the async work itself needs cancellation, use an `AbortController` or a `cancelled` flag ref.
- Discovered in RepoTracker `StepDone.tsx` during code review.
