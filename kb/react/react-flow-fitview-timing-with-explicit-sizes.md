---
tech: react
tags: [react-flow, xyflow, fitview, layout]
severity: medium
---
# React Flow: fitView from an effect on useNodesInitialized never fires with explicit node sizes

## PROBLEM
A refit effect gated on useNodesInitialized() never ran when nodes carry explicit width/height, so the chart opened at the default viewport. Calling fitView inside the same render also measures stale positions.

## WRONG
```tsx
const ready = useNodesInitialized();
useEffect(() => { if (ready) flow.fitView(); }, [ready]);
```

## RIGHT
```tsx
<ReactFlow fitView fitViewOptions={FIT} ... />
const first = useRef(true);
useEffect(() => {
  if (first.current) { first.current = false; return; }
  const raf = requestAnimationFrame(() => void flow.fitView({ ...FIT, duration: 400 }));
  return () => cancelAnimationFrame(raf);
}, [layout]);
```

## NOTES
fitViewOptions accepts `nodes: [{id}]` to fit a subset (focus mode).
