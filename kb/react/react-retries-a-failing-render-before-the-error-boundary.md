---
tech: react
tags: [error-boundary, render, retry, testing, vitest, side-effects, console-error]
severity: medium
---
# React retries a failing render before an error boundary sees it

## PROBLEM
When a component throws while rendering, React does not hand the error to the nearest error boundary straight away: it renders the component again first, and only if it throws again does the boundary's fallback appear. A test that counts how many times the component rendered, how many times a mocked function was called during render, or how many errors were logged, sees more than the one failure it expected.

## WRONG
```tsx
const load = vi.fn(() => { throw new Error("boom"); });
function Broken() { load(); return null; }

render(<ErrorBoundary fallback={<p>failed</p>}><Broken /></ErrorBoundary>);
expect(load).toHaveBeenCalledTimes(1);      // fails: the render was retried
```

## RIGHT
```tsx
render(<ErrorBoundary fallback={<p>failed</p>}><Broken /></ErrorBoundary>);
expect(screen.getByText("failed")).toBeInTheDocument();   // assert the outcome
expect(load).toHaveBeenCalled();                          // not an exact count
```

## NOTES
- Assert on what the user sees (the fallback), not on how many attempts React made to get there.
- It is one more reason to keep render free of side effects: anything done during render can happen more than once.
