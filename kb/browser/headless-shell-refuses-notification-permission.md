---
tech: browser
tags: [chromium, headless, cdp, notifications, service-worker, web-push]
severity: medium
---
# Headless-shell can refuse notifications after a successful DevTools grant

## PROBLEM

A service-worker browser test uses the standalone chrome-headless-shell binary.
Browser.grantPermissions with notifications returns successfully, but the page
still reports Notification.permission as denied. The actual worker receives the
push event and showNotification rejects with no notification permission. Waiting
for getNotifications() merely times out, suggesting a worker or payload bug.

Observed with Playwright's installed Chromium build 1243. The full Chromium binary
from the same installation, launched with --headless, reported granted and passed
the unmodified worker test. Do not assume the two executables expose every same
browser facility, and do not treat a successful protocol call as effective state.

## WRONG

```javascript
// Standalone headless-shell, then assume the permission override took effect.
await cdp.send('Browser.grantPermissions', {
  origin, permissions: ['notifications'],
});
await deliverPushAndWaitForNotification();
```

## RIGHT

```javascript
// Launch the full Chromium executable with --headless for this test.
await cdp.send('Browser.grantPermissions', {
  origin, permissions: ['notifications'],
});
await navigateToFixture(origin);
assert.equal(await pageEvaluate('Notification.permission'), 'granted');
await deliverPushAndWaitForNotification();
```

## NOTES

Subscribe to ServiceWorker.workerErrorReported so a permission failure is reported
directly instead of as a later timeout. Use a secure origin or a localhost test
origin accepted by the browser.

This verifies browser worker behavior only. A headless test does not establish
Windows banners, Notification Center integration, actual FCM/WNS provider delivery,
or fully exited browser behavior. Record those acceptance results separately.
This is a browser harness issue, not an agent-configuration defect; no configuration
guard is appropriate. Assert observed permission in the harness itself.
