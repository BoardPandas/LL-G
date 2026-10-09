---
tech: macos
tags: [screencapturekit, display-sleep, iokit, remote-desktop, capture, cgo, go]
severity: high
---
# A sleeping display is not active, so ScreenCaptureKit lists no displays

## PROBLEM
macOS counts a sleeping display as *online* but not *active*
(`CGGetOnlineDisplayList` vs `CGGetActiveDisplayList`), and `SCShareableContent`
lists only active displays. On a Mac whose screen is off but which is otherwise
awake, display enumeration therefore succeeds and returns **zero** displays.

Code that folds "zero displays" into a fatal "unsupported / cannot capture"
error ends the session before the first frame. In a remote-desktop host, that
shows up on the viewer as an unrelated transport error (here
`websocket: close 4410: peer disconnected`), and the same session works as
soon as someone at the machine touches the trackpad. That makes it look
intermittent.

A `kIOPMAssertionTypeNoDisplaySleep` / `PreventUserIdleDisplaySleep` assertion
does **not** help: it stops a lit display from dimming and does nothing for one
that is already dark.

Measured on hardware: after `pmset displaysleepnow`, SCShareableContent listed 0
displays within ~86 ms. After declaring user activity, the display was listed
again in 84 ms and a full-resolution frame was captured. `pmset -g log` showed
`Created UserIsActive` followed by `Display is turned on` in the same second.
No TCC permission is needed to wake the display.

## WRONG
```objc
int count = /* fill from content.displays */;
if (count == 0) {
  sf_set_err(err, errlen, @"macOS reported no capturable displays");
  return -1;  // caller treats this exactly like a Screen Recording denial
}
```

## RIGHT
```objc
#include <IOKit/pwr_mgt/IOPMLib.h>   // link -framework IOKit

// Wake the panel the way a key press does. Reuse/update the same id.
IOPMAssertionID id = kIOPMNullAssertionID;
IOPMAssertionDeclareUserActivity(CFSTR("Remote session"), kIOPMUserActiveLocal, &id);
// ...then enumerate, returning 0 (success, empty) instead of -1 for no displays...
// ...release with IOPMAssertionRelease(id) when the session ends.
```
```go
// Wake, then retry ONLY the empty-list case for a bounded time.
for attempt := 0; attempt < 40; attempt++ {
	if attempt > 0 { time.Sleep(250 * time.Millisecond) }
	_ = wake()
	monitors, err := enumerate()
	if err != nil && !errors.Is(err, errNoActiveDisplay) {
		return nil, err // TCC denial, old OS: waiting cannot fix these
	}
	if len(monitors) > 0 { return monitors, nil }
}
```

## NOTES
- Keep "empty list" as a distinct success value (0) from the C layer, so
  "asleep" stays distinguishable from "cannot capture" (-1).
- Wake unconditionally at session start, not only on an empty list: a screen
  seconds from dimming would otherwise go dark right after the stream opens.
- Declared activity lapses after the user's display-sleep setting, just like a
  key press. Holding the display on for a whole session is a separate,
  explicit `NoDisplaySleep` assertion.
- Diagnose from the host's own log plus `pmset -g log | grep "Display is turned"`.
- Seen in BoardPandas/supportforge-platform #308, fixed in 5f13b3839
  (`desktop_agent_v2/internal/remotecontrol/display_wake.go`, `capture_darwin.m`).
