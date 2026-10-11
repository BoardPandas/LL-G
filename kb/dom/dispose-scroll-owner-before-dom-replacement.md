---
tech: dom
tags: [dom, scroll-restoration, innerhtml, lifecycle, repaint]
severity: high
---
# Dispose a scroll owner before replacing its DOM

## PROBLEM

A component that registers a nested scroll element may rebuild that element with `innerHTML` or
`replaceChildren`. If it calls the registration disposer from an after-paint hook, the old element
is already disconnected. A defensive controller correctly refuses to read it, and a pending
animation-frame save also skips it, so the last visible scroll position is silently lost. Most
returns still look correct because an earlier frame was saved; the bug appears only when repaint
follows the final scroll in the same frame or when a state-changing click immediately rebuilds the
surface.

## WRONG

```js
function paint(view) {
  root.innerHTML = render(view);
  disposeScroll?.();
  disposeScroll = registerScrollPort(root.querySelector(".results"));
}
```

## RIGHT

```js
function beforePaint() {
  disposeScroll?.(); // checkpoints while the old element is still connected
  disposeScroll = null;
}

function paint(view) {
  beforePaint();
  root.innerHTML = render(view);
  disposeScroll = registerScrollPort(root.querySelector(".results"));
}
```

## NOTES

For a shared renderer with error, loading, empty, and success branches, run the pre-paint hook
before the first branch that can replace content; do not put it only in the successful layout
path. Pin the source or behavior ordering in a regression test so a later cleanup cannot move
disposal back into `afterPaint`.
