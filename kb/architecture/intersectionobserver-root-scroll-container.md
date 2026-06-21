---
tech: architecture
tags: [intersectionobserver, lazy-load, scroll-container, overflow, dom-api, viewport]
severity: medium
---
# IntersectionObserver root must be the scroll container, not the viewport, when the app scrolls inside an element

## PROBLEM
`IntersectionObserver` with the default `root: null` observes intersections against the
VIEWPORT. Many app shells scroll inside an inner element (e.g. `<main style="overflow:auto">`)
rather than the document, so below-the-fold content is clipped by that container, not the
window. Against the viewport those children may already be "intersecting" (the viewport never
clips them), so a lazy-load/reveal observer either fires for everything immediately (no lazy
behavior) or never fires at the right moment. The lazy-load looks broken or pointless; the real
cause is observing the wrong root.

The same mismatch bites scroll math: `window.scrollY` / `document.scrollingElement.scrollTop`
read 0 because the document doesn't scroll -- you must read `scrollTop` off the actual scroll
container.

## WRONG
```js
// app scrolls inside #shell-main { overflow:auto }, but we observe the viewport
const io = new IntersectionObserver(onApproach, { rootMargin: "320px" }); // root: null = viewport
sections.forEach(s => io.observe(s)); // mis-fires: viewport never clips these children
```

## RIGHT
```js
const scrollContainer = document.querySelector("#shell-main"); // the overflow:auto element
const io = new IntersectionObserver(onApproach, {
  root: scrollContainer,       // observe against the real scroll container
  rootMargin: "320px",         // hydrate a bit before it enters view
});
sections.forEach(s => io.observe(s));

// and read scroll position off the same element, not window:
const y = scrollContainer.scrollTop;
```

## NOTES
- Rule of thumb: the IO `root` must be whatever element actually does the scrolling/clipping.
  If `getComputedStyle(el).overflowY` is `auto`/`scroll` on an ancestor, that ancestor is your
  root.
- Pass the scroll container down from the shell to the section rather than re-querying, so the
  reference is guaranteed correct.
- Related: [[capture-phase-popstate-scroll-restore]] (same scroll container is where you
  save/restore scrollTop).
