---
tech: react
tags: [react-three-fiber, drei, html, portals, cleanup, browser-testing]
severity: high
---
# Keep drei Html portal targets stable during Canvas teardown

## PROBLEM

Unmounting a fully rendered star map raised `NotFoundError: Failed to execute
'removeChild' on 'Node'`. The page could still display its list alternative, so
checking the new button or heading alone missed the uncaught error.

Reproduced with React 19.3.0, react-three-fiber 9.8.1 and drei 10.7.9. Instrumenting
the failing DOM removal identified the inner `10 ly` label already detached from
its Html root. Twelve repeated mounted-map transitions reproduced the error.

In that drei version, Html chooses its target from `portal.current`, then
`events.connected`, then the canvas parent. Its layout effect creates a React DOM
root and depends on that target. Canvas teardown can change the implicit target
while the previous root is being unmounted. Giving Html an explicit container that
remains stable through cleanup eliminated the reproduction.

## WRONG

```tsx
<Canvas>
  <Html position={[10, 0, 0]} center>
    <span>10 ly</span>
  </Html>
</Canvas>
```

An ordinary host ref passed directly as the portal can also become null when the
outer React tree removes the host, returning Html to its implicit target selection.
Do not suppress the exception, patch `removeChild`, or retain a hidden live canvas
just to avoid exercising cleanup.

## RIGHT

Give the labels their own stable DOM container. Mount it inside a dedicated empty
host, and pass the same portal object to every Html component in the scene.

```tsx
function MapScene() {
  const host = useRef<HTMLDivElement>(null);
  const [portal] = useState(() => ({ current: document.createElement("div") }));

  useLayoutEffect(() => {
    host.current?.appendChild(portal.current);
    return () => portal.current.remove();
  }, [portal]);

  return (
    <div className="relative">
      <Canvas>
        <Html portal={portal} position={[10, 0, 0]} center>
          <span>10 ly</span>
        </Html>
      </Canvas>
      <div ref={host} className="pointer-events-none absolute inset-0" />
    </div>
  );
}
```

The portal still points to the same container after that container is detached.
Drei can finish cleaning up its own label roots without selecting a new target.
Only append external children to the dedicated empty host; do not mutate DOM
children owned by the application React tree.

## NOTES

- This initializer uses `document`: instantiate the scene only in the browser.
- Browser regressions must listen for `pageerror`, wait for an actual scene label
  to become visible, then switch repeatedly between visual/list modes and recreate
  the Canvas camera mode. Clicking List before the lazy scene mounts avoids the bug.
- The fix passed six visual/list cycles plus four map/3D changes at both phone and
  desktop widths. Preserve real teardown; do not narrow tests to an empty canvas.
- This is a version-specific observed integration failure, not a claim that every
  Html component or future drei release needs this workaround.
