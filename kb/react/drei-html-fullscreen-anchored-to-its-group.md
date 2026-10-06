---
tech: react
tags: [react-three-fiber, drei, three.js, labels]
severity: high
---
# drei <Html fullscreen> is anchored to its group's projected position, not the canvas corner

## PROBLEM
drei positions an Html element at the projection of its parent group; `fullscreen` only adds a -width/2,-height/2 offset. Placed at the scene root, the layer's origin follows the projected world origin (here Sol), so labels positioned by projecting each object to canvas pixels all sit shifted by the origin's offset from the centre -- correct when the origin is centred, wrong everywhere else, so it slips through a quick look.

## WRONG
```tsx
<Canvas>
  <Html fullscreen>{labels /* translated to projected px */}</Html>
</Canvas>
```

## RIGHT
```tsx
const reg = useRef(newRegistry()).current;
<div className="relative h-full w-full">
  <Canvas>{/* ... */}<LabelDriver registry={reg} /></Canvas>
  <div className="pointer-events-none absolute inset-0">{labels /* refs in reg */}</div>
</div>
// LabelDriver: useFrame -> v.set(...p).project(camera); x=(v.x/2+.5)*w; y=(-v.y/2+.5)*h
```
