---
tech: windows
tags: [web-push, notifications, vivaldi, browser, registry, acceptance]
severity: high
---
# Browser push registration and registry settings do not prove visible notifications

## PROBLEM

A browser can grant a website Notification permission, retain a valid push
subscription and receive provider-accepted sends while Windows suppresses that
browser's notifications independently. Reporting enrollment as successful display
hides the failure from users.

In a Windows 11 Vivaldi pilot, the current user's per-app notification registry
entry had Enabled=0. Setting it to 1 and reading it back did not restore visible
test alerts. The signed-in user toggled the app off and on through Windows
Settings and confirmed that the next test appeared. The exact internal Windows
refresh mechanism was not established; do not claim a registry write is a
supported or sufficient repair.

## WRONG

```js
await savePushSubscription(subscription);
setStatus('Notifications are working'); // enrollment is not visual acceptance
// Nor does provider HTTP 201, showNotification() resolving, or Enabled=1 prove it.
```

## RIGHT

```js
await savePushSubscription(subscription);
setStatus('Background delivery registered');
await registration.showNotification('Application', {
  body: 'Display check. Return to the app to confirm you saw this.',
  tag: 'notification-display-check', silent: true,
});
setStatus('Did the notification appear?'); // require human confirmation
// Separately test the server/provider path; retain each result independently.
```

When missing, guide the user to the site's browser permission, Windows Settings
> System > Notifications > the relevant browser, notification banners, and Do not
disturb. A user-activated `ms-settings:notifications` link opens the supported OS
settings page. On the affected installation, toggling the existing app switch
through that page restored delivery. Do not silently override user preferences,
restart their browser with unsaved work, or add an elevated bridge just to bypass
the browser sandbox.

## NOTES

- Registry reads from SYSTEM must resolve the intended loaded user's SID first;
  SYSTEM's HKCU does not describe the interactive user. Remote SYSTEM execution
  cannot prove the interactive user's banner or Notification Center state.
- Websites cannot change Windows' per-browser notification switches. Keep the
  OS repair user controlled and distinguish local display from network push.
- OS preferences, focus modes, private browsing and fully exited processes have
  separate effects. A test in one browser/profile is not proof for another.
- Evidence: SupportForge Windows 11 pilot, Vivaldi 8.2.4133.84, 2026-10-15.
- [Microsoft settings URI documentation](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings)
- [Vivaldi website permissions](https://help.vivaldi.com/desktop/privacy/website-permissions/)
