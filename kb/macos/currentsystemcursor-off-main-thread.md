---
tech: macos
tags: [macos, appkit, nscursor, cgo, threads]
severity: low
---
# [NSCursor currentSystemCursor] works off the main thread without NSApplication

## PROBLEM
It is easy to assume AppKit calls need the main thread or a running NSApplication and to build a main-thread trampoline for a Go/cgo agent. Measured: currentSystemCursor returns the real pointer from a non-main thread in a process with no NSApplication, inside @autoreleasepool, and memory stays flat over 90,000 reads (leaks finds nothing).

## WRONG
```objc
// dispatch_sync(dispatch_get_main_queue(), ...) from a Go process whose main thread never runs a run loop -> deadlock
```

## RIGHT
```objc
@autoreleasepool { NSCursor *c = [NSCursor currentSystemCursor]; if (!c) return 0; /* read image + hotSpot */ }
```

## NOTES
Apple marks the method "to be deprecated"; guard with respondsToSelector and treat nil as unreadable. Throttle full reads (about 10 Hz): the window-server call costs 150-350 us.
