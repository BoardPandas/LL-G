---
tech: chrome
tags: [chrome, automation, screenshot, visibility]
severity: low
---
# Browser-extension screenshots time out when the tab is hidden

## PROBLEM
A screenshot of a freshly deployed app timed out repeatedly, suggesting a render-loop freeze. The tab was simply not visible, so Chrome throttled painting.

## WRONG
```js
// screenshot times out -> assume the app hung
```

## RIGHT
```js
document.visibilityState // 'hidden' -> focus/activate the tab, then screenshot
```
