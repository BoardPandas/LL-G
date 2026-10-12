---
tech: browser
tags: [chromium, playwright, display-mode, fullscreen, cdp, xvfb]
severity: high
---
# Chromium fullscreen APIs do not prove native display-mode fullscreen

## PROBLEM

A headed Chromium test under Xvfb can report `document.fullscreenElement` after `requestFullscreen()` while `matchMedia("(display-mode: fullscreen)")` still reports browser mode. That creates a silent false positive for installed-app/native-window responsive behavior: the page is fullscreen inside a browser window, not running in the native display mode that production users receive. Chromium command-line `--app=about:blank` also does not establish an app-mode window for a later navigation. In a no-JavaScript execution context, `requestAnimationFrame()` does not fire, so readiness checks based on it can hang even after the visible DOM is ready.

## WRONG

```js
await page.evaluate(() => document.documentElement.requestFullscreen());
expect(await page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
expect(await page.evaluate(() => matchMedia("(display-mode: fullscreen)").matches)).toBe(true);
```

## RIGHT

```js
const browser = page.context().browser();
const session = await page.context().newCDPSession(page);
const { windowId } = await session.send("Browser.getWindowForTarget");
await session.send("Browser.setWindowBounds", {
  windowId,
  bounds: { windowState: "fullscreen" },
});

await expect.poll(() => page.evaluate(() => ({
  nativeFullscreen: matchMedia("(display-mode: fullscreen)").matches,
  viewport: [innerWidth, innerHeight],
}))).toEqual({ nativeFullscreen: true, viewport: [1280, 720] });
```

## NOTES

Use a headed, persistent-viewport Chromium instance under a window manager such as Openbox. Start the browser in app mode against a same-origin inert document (for example `/icon.svg`) and then navigate to the target route; this preserves app mode, unlike `--app=about:blank`. For no-JavaScript documents, wait for visible DOM plus a synchronous measurement instead of `requestAnimationFrame()`.
