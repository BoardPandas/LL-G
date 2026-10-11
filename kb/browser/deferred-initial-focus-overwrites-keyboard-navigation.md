---
tech: browser
tags: [focus, requestAnimationFrame, keyboard, accessibility, race-condition]
severity: high
---
# Deferred initial focus can overwrite immediate keyboard navigation

## PROBLEM
A hosted menu can focus its first item synchronously and then schedule a second "initial" focus
assignment in `requestAnimationFrame`. If a keyboard user presses End or an arrow key before that
frame runs, their navigation succeeds briefly and is then silently undone by the stale callback.
The race is easy to miss because it depends on frame timing, viewport work, and input speed; a
normal browser check often sees only the final wrong item.

## WRONG
```js
focusItem(items, 0);
requestAnimationFrame(() => {
  focusItem(items, selectedIndex);
});
```

## RIGHT
```js
const targetIndex = selectedIndex >= 0 ? selectedIndex : 0;
focusItem(items, targetIndex);
```

Choose the final initial target before returning control to the user. If presentation genuinely
requires deferred focus, cancel or skip the callback once focus has moved through user input.

## NOTES
Regression-test the race by queueing animation-frame callbacks, dispatching End or ArrowDown, then
flushing the queued frame and asserting focus stays on the user-selected item.
