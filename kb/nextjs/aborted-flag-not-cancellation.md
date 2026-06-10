---
tech: nextjs
tags: [react, fetch, abortcontroller, useeffect, memory-leak, performance]
severity: medium
---
# The aborted-flag cleanup pattern does not cancel in-flight fetches

## PROBLEM
The common `let aborted = false` pattern in a useEffect fetch only prevents setState after unmount. The HTTP request itself still runs to completion: the server does the work, the response downloads and parses, and only then is the result thrown away. In list/detail UIs where users click through items quickly (each detail panel firing several fetches), this piles up wasted requests against the backend and delays the responses the user actually wants. Nothing errors, so it looks fine in light testing. Found as the uniform pattern across ~8 effects in one component tree.

## WRONG
```tsx
useEffect(() => {
  let aborted = false;
  (async () => {
    const res = await fetch(`/api/v1/tickets/${ticketId}/persona`); // keeps running after unmount
    const data = await res.json();
    if (!aborted) setPersona(data);
  })();
  return () => { aborted = true; }; // blocks setState only, not the request
}, [ticketId]);
```

## RIGHT
```tsx
useEffect(() => {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(`/api/v1/tickets/${ticketId}/persona`, {
        signal: controller.signal,
      });
      const data = await res.json();
      setPersona(data); // unreachable after abort; the await throws instead
    } catch (e: any) {
      if (e?.name !== 'AbortError') console.error('persona fetch failed', e);
    }
  })();
  return () => controller.abort(); // actually cancels the network request
}, [ticketId]);
```

## NOTES
Swallow only AbortError in the catch; real failures must still surface. The flag pattern is still useful for non-fetch async work that cannot be cancelled, but for fetch always pass the signal. With React 18 StrictMode double-invoking effects in dev, the abort path runs immediately on mount, which is a good early test that the AbortError handling is correct.
