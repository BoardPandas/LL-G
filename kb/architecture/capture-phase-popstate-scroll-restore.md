---
tech: architecture
tags: [spa, router, popstate, scroll-restoration, event-capture, history-api]
severity: medium
---
# Capture-phase popstate to know nav direction before a synchronous SPA router mounts

## PROBLEM
A custom SPA shell router typically runs its `route()` synchronously inside the
`popstate` dispatch and mounts the new section immediately. Any section that wants to
know "is this a back/forward navigation?" at mount time (e.g. to restore scroll
position vs. reset to top) registers its own `popstate` listener -- but a normal
(bubble-phase) listener fires AFTER the shell's listener, so the section has already
mounted and read the flag before it was set. Result: scroll-restore silently never
fires; the page always resets to the top on back/forward. It looks like the restore
code "does nothing," but the real cause is listener ordering.

Key facts: `pushState`/`replaceState` do NOT emit `popstate` (only real back/forward
and `history.go` do), so a fresh in-app navigation must read the flag as "not a pop"
and let the router's normal scroll-to-top win.

## WRONG
```js
// section module
let navPop = false;
window.addEventListener("popstate", () => { navPop = true; }); // bubble phase: too late

export function mount(root) {
  // shell.route() already ran (also on popstate) and mounted us; navPop is still false here
  if (navPop) restoreScroll(root); else root.scrollTop = 0; // restore never runs
}
```

## RIGHT
```js
let navPop = false;
// capture phase fires BEFORE the shell's bubble-phase popstate->route() handler
window.addEventListener("popstate", () => { navPop = true; }, true);

export function mount(root) {
  if (navPop) {
    const y = Number(sessionStorage.getItem(SCROLL_KEY) || 0);
    requestAnimationFrame(() => { root.scrollTop = y; });
  } else {
    root.scrollTop = 0;            // fresh pushState entry: no restore
  }
  navPop = false;                  // reset for the next navigation
}

// save (rAF-throttled) while the user scrolls the container
scrollContainer.addEventListener("scroll", throttle(() => {
  sessionStorage.setItem(SCROLL_KEY, String(scrollContainer.scrollTop));
}));
```

## NOTES
- Works for any framework where the router handler is itself a `popstate` listener and
  runs synchronously: register your direction-detector in the capture phase so it
  precedes the router.
- Persist scroll to `sessionStorage` (per-tab) keyed by path; restore inside `rAF` so it
  applies after the section's DOM exists.
- Related: [[intersectionobserver-root-scroll-container]] when the scrolled element is an
  inner `overflow:auto` container rather than the window.
