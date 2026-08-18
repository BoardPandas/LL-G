---
tech: dom
tags: [getElementById, duplicate-id, modal, overlay, innerHTML, addEventListener, querySelector, z-index, stacking-context, event-listener, dead-button]
severity: high
---
# A dynamically built overlay wired with document.getElementById dies silently once two instances coexist

## PROBLEM
A modal builder creates an element, sets `innerHTML` containing buttons with `id="..."`, appends it to `document.body`, then wires handlers with `document.getElementById(...)`. This works perfectly until the builder runs twice before the first instance is removed — then the app hard-locks with no error anywhere.

`getElementById` returns the **first** match in tree order, and `appendChild` puts each new overlay **last**. So on the second call:

- Overlay **A** (still mounted, because a modal that resolves a Promise only inside its click handlers is never removed by anything else) gets **both** sets of listeners — two per button.
- Overlay **B** gets **zero** listeners.

Both overlays are typically `position: fixed; inset: 0` with the same `z-index`. Equal `z-index` in the same stacking context paints in tree order, so **B is on top** and swallows every pointer event (CSSOM View hit-testing returns the topmost element). The user only ever interacts with the overlay that has no handlers.

The signature is brutal to diagnose: the buttons are real, enabled `<button>` elements, so `:active`/`:hover` CSS still fires — **the button visibly depresses and nothing happens**. No console error, no exception, no failed network call. It looks like a CSS or pointer-events problem, which it is not. Because the Promise never settles, any `finally` block after the `await` never runs either, so cleanup and follow-on work (starting a sync, releasing a lock) are silently skipped for the rest of the page's life.

Anything that re-invokes the builder triggers it: an auth callback that fires twice, a websocket reconnect, a router remount, a retry, a double-click on the opener.

## WRONG
```js
function showPrompt() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.innerHTML = `
      <button id="prompt-cancel">Cancel</button>
      <button id="prompt-confirm">Confirm</button>
    `;
    document.body.appendChild(overlay);

    // Global lookups: return overlay A's buttons whenever A is still mounted.
    document.getElementById('prompt-cancel').addEventListener('click', () => {
      overlay.remove(); resolve('cancel');
    });
    document.getElementById('prompt-confirm').addEventListener('click', () => {
      overlay.remove(); resolve('confirm');
    });
  });
}
```

## RIGHT
```js
// Single-flight: concurrent callers share one overlay instead of stacking a second.
let promptPromise = null;

function showPrompt() {
  if (promptPromise) return promptPromise;

  promptPromise = new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    // No ids -- a dynamically created node may exist in multiples by construction.
    overlay.innerHTML = `
      <button data-choice="cancel">Cancel</button>
      <button data-choice="confirm">Confirm</button>
    `;

    function onKeydown(e) { if (e.key === 'Escape') finish('cancel'); }

    function finish(choice) {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
      promptPromise = null;   // let a later, legitimate prompt open
      resolve(choice);
    }

    // Scope every lookup to the element you just built.
    for (const btn of overlay.querySelectorAll('[data-choice]')) {
      btn.addEventListener('click', () => finish(btn.dataset.choice));
    }

    document.addEventListener('keydown', onKeydown);
    document.body.appendChild(overlay);
  });

  return promptPromise;
}
```

## NOTES
- **Both halves are required.** Scoping to `overlay.querySelector` alone leaves two stacked overlays — the top one now works, but dismissing it reveals a second identical prompt. The single-flight guard alone still leaves the ids duplicated for anything else that queries them.
- Reset the single-flight handle inside `finish`, not in the caller. Forgetting it means the modal can never open again, trading a lockout for a no-op.
- Prefer `data-*` attributes or direct element references over ids for anything built at runtime. An id is a document-wide singleton assertion; a node created by a function is not a singleton.
- HTML permits duplicate ids — no validator, linter, or devtools warning fires. `document.querySelectorAll('#some-id').length > 1` in the console is the fastest confirmation on a stuck page.
- The same class of bug hits `document.querySelector('#id')`, jQuery `$('#id')`, and `getElementsByName` — anything rooted at `document` rather than the subtree you created.
- Recovery on an already-stuck page: `document.getElementById('<id>').click()` fires the buried, wired listeners (clearing every accumulated Promise at once), then `document.querySelectorAll('.modal-overlay').forEach(el => el.remove())` clears the orphan.
- Always give a blocking, full-viewport overlay an escape hatch (Escape key or a dismiss button). Without one, a single wiring mistake is an unrecoverable lockout rather than an annoyance — and users cannot reach a "sign out" or "reset" control to fix it themselves.
