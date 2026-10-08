---
tech: browser
tags: [playwright, requestanimationframe, input, cancellation, race]
severity: medium
---
# Pre-event snapshots cannot prove post-event cancellation

## PROBLEM
A browser test reads state while a repeating animation frame is active, then sends a cancellation
input such as Escape and expects the post-cancellation state to equal the earlier read. Input
delivery is asynchronous, so another animation frame can legitimately run between the read and the
event. The test intermittently reports one extra movement tick even when cancellation correctly
stops every frame after the event is observed.

## WRONG
```js
const beforeCancel = await page.evaluate(readCamera);
await page.keyboard.press("Escape");
await page.waitForTimeout(50);
expect(await page.evaluate(readCamera)).toEqual(beforeCancel);
```

## RIGHT
```js
await page.keyboard.press("Escape");
await page.waitForFunction(() => !document.querySelector(".drag-layer"));
const afterCancel = await page.evaluate(readCamera);
await page.waitForTimeout(50);
expect(await page.evaluate(readCamera)).toEqual(afterCancel);
```

## NOTES
If event-delivery latency is itself a requirement, measure and bound it separately. Do not use a
state snapshot taken before the input event as the cancellation boundary.
