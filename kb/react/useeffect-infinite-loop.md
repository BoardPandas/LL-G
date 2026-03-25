---
tech: react
tags: [useEffect, state, infinite-loop, re-render]
severity: high
---
# useEffect infinite loop when state setter depends on its own state

## PROBLEM

Calling a state setter inside a `useEffect` whose dependency array includes that same state creates an infinite re-render loop. The effect fires, updates state, which triggers the effect again. Even if a guard condition (like `=== null`) prevents redundant work, the component still re-renders every cycle because the state reference changes.

This is especially insidious when the effect iterates over an array in state and conditionally updates individual items -- each update creates a new array reference, re-triggering the effect.

## WRONG

```tsx
const [dirInfos, setDirInfos] = useState<DirInfo[]>([]);

useEffect(() => {
  for (const info of dirInfos) {
    if (info.repoCount === null) {
      fetchCount(info.path).then((count) => {
        setDirInfos((prev) =>
          prev.map((d) => (d.path === info.path ? { ...d, repoCount: count } : d))
        );
      });
    }
  }
}, [dirInfos]); // dirInfos changes on every setDirInfos call
```

## RIGHT

Decouple the trigger from the state being mutated. Use a separate effect trigger or process new items only:

```tsx
const [dirInfos, setDirInfos] = useState<DirInfo[]>([]);
const [pendingPaths, setPendingPaths] = useState<string[]>([]);

// Only fire when new paths are added
useEffect(() => {
  for (const path of pendingPaths) {
    fetchCount(path).then((count) => {
      setDirInfos((prev) =>
        prev.map((d) => (d.path === path ? { ...d, repoCount: count } : d))
      );
    });
  }
  setPendingPaths([]);
}, [pendingPaths]);
```

Or use a ref to track which paths have been fetched, avoiding the dependency entirely.

## NOTES

- React DevTools Profiler will show rapidly incrementing render counts.
- StrictMode in development doubles the effect, making the loop even more visible.
- The guard condition (`=== null`) prevents infinite API calls but does NOT prevent infinite re-renders.
- Discovered in RepoTracker `StepDirectories.tsx` during code review.
