---
tech: architecture
tags: [guards, lifecycle, ui, controller, double-submit, optimistic-ui, dead-control]
severity: high
---
# An in-flight guard that reads the busy flag the caller just set refuses the very press that set it

## PROBLEM

A slow action gets two things that look independent and are not:

- the **controller** sets a `busy` / `loading` / `pending` flag and repaints, so the
  user sees skeletons or a disabled button before the request goes out, and
- the **action** (a pure reducer, a thunk, a handler) guards against double submission
  with `if (state.busy) return`.

Put the guard in the action and it reads the flag the controller set one line earlier
*to show the work starting*. The press paints a perfect busy state and never performs
the work. Nothing throws. The control looks alive, the spinner is correct, and the
request is never made.

It survives review and testing for a specific reason: the two halves are usually tested
separately. Unit cases call the action directly with a freshly built state, where the
flag is clear, so every branch passes. Integration proof often goes through an API
client or CLI rather than the button, so the route is observed working. The only path
that fails is the real one.

Measured on one repo: a "Draft four ideas" button shipped dead for a release. The
controller painted four placeholder tiles before a roughly 40-second call because a
control that does not change reads as broken; the action began `if (state.drafting)
return state`. Drafting through the API worked, so it went unnoticed, and a second
module written from the same template was about to ship the same bug.

## WRONG

```js
// controller: paint the busy state BEFORE the call, which is correct UX
async function handle(press) {
  if (starting) {
    state = { ...state, drafting: true };   // the view needs this now
    repaint();
  }
  const next = await runAction(press, { state });   // <-- state.drafting is true
  state = next;
  repaint();
}

// action: guards against a double press by reading the same flag
export async function runAction(press, { state }) {
  if (press.kind === "draft") {
    if (state.drafting) return state;   // <-- refuses the press that set it
    return { ...state, ideas: await draft() };
  }
}
```

## RIGHT

```js
// The guard belongs to whatever owns the LIFECYCLE, with its own variable --
// not the one the view reads -- and it is cleared in `finally` so a failure
// does not leave the control dead until reload.
export function makeController({ repaint, onError }) {
  let state = { drafting: false };
  let inFlight = false;                 // lifecycle, not presentation

  return {
    async handle(press) {
      const starting = press.kind === "draft";
      if (starting) {
        if (inFlight) return;           // the one place that knows
        inFlight = true;
        state = { ...state, drafting: true };
        repaint();
      }
      try {
        state = await runAction(press, { state });
        repaint();
      } catch (error) {
        onError(error);
      } finally {
        if (starting) inFlight = false;
      }
    },
  };
}

// The action answers "what does this press mean", and nothing about timing.
export async function runAction(press, { state }) {
  if (press.kind === "draft") return { ...state, drafting: false, ideas: await draft() };
  return state;
}
```

```js
// And test it by PRESSING, through the controller. A case that calls the action
// directly cannot see this class of bug at all.
it("reaches the route, and a second press while one is in flight does not", async () => {
  const controller = makeController({ repaint() {}, onError() {} });
  const first = controller.handle({ kind: "draft" });
  await controller.handle({ kind: "draft" });     // during the first
  await first;
  expect(calls).toHaveLength(1);
});
```

## NOTES

- The tell is a control that paints its busy state perfectly and never produces a
  request. Check the network panel, not the pixels.
- One flag cannot be both "the view should look busy" and "do not start another".
  They have different owners and different lifetimes: the first is state the view
  renders, the second is a fact about an outstanding promise.
- Clear the lifecycle flag in `finally`. A failed attempt that leaves it set turns a
  one-off error into a control that is dead until the page reloads.
- Defence in depth is still right: keep the disabled attribute on the button for the
  common case and a server-side refusal (409) for two tabs. The bug here is not having
  three guards; it is putting one of them where it can see a flag it does not own.
- The same shape appears with `isSubmitting` in form libraries, `pending` in reducers,
  and `aria-busy` driven from the same field a saga checks. Wherever the view's busy
  state and the concurrency guard read one variable, look for this.
