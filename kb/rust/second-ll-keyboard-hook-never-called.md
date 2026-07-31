---
tech: rust
tags: [windows, wh_keyboard_ll, setwindowshookex, low-level-hook, input, hotkey, win32, silent-failure]
severity: high
---
# A second WH_KEYBOARD_LL hook in the same process installs, reports healthy, and is never called

## PROBLEM

A process that already runs one low-level keyboard hook (push-to-talk, a global
hotkey, an input logger) eventually needs a second, different consumer of the
key stream -- classically a "record a shortcut" settings UI that wants raw
edges rather than resolved chords. The obvious move is to install a second
`WH_KEYBOARD_LL` hook on its own dedicated message-pumping thread, reusing the
exact code that already works.

**On real hardware that second hook is never called.** `SetWindowsHookExW`
returns a valid `HHOOK`. The thread runs `GetMessageW` forever. The thread
stays alive. `GetLastError` is clean. And not one callback arrives, while the
*first* hook -- same callback function, same `spawn_hook` code, same dedicated
pumping thread -- keeps receiving every keystroke in the same session.

Measured: a capture hook installed for 51 seconds, with the user holding
combination after combination the whole time, logged zero callbacks. Dictation
through the other hook worked minutes earlier and minutes later.

What makes this expensive is that **every diagnostic you reach for says
"fine"**:

- Install succeeded, so you rule out permissions and hook-chain problems.
- The thread is alive and pumping, so you rule out the one documented failure
  mode (*"the thread that installed the hook must have a message loop"*), which
  is also the only answer search results will give you.
- Integrity level, session id, duplicate processes, `LowLevelHooksTimeout`,
  UIPI, elevation -- all check out.

So you conclude the bug must be in your own plumbing (channels, thread
lifetimes, UI repaint) and burn release after release instrumenting code that
was correct all along. The failure is in the OS's willingness to deliver, not
in anything you can see from inside the process.

Do not spend the time confirming *why*. Route around it.

## WRONG

```rust
// Consumer 1: the always-on hotkey listener. Works.
pub fn spawn_listener(chord: PttChord, tx: Sender<PttEvent>) -> Result<ListenerHandle, Error> {
    spawn_hook("hotkey", HookState::Ptt { tracker: ChordTracker::new(chord), tx })
}

// Consumer 2: the settings recorder. Identical code, identical thread shape.
// Installs cleanly, pumps messages, stays alive -- and is never called.
pub fn spawn_capture(tx: Sender<CaptureEvent>) -> Result<ListenerHandle, Error> {
    spawn_hook("hotkey-capture", HookState::Capture { tx })
}

// Worse, the caller usually tears the first hook down to "make room" for the
// second, on the folk belief that only one LL hook may run at a time:
match action {
    Action::StartRecording => {
        pipeline.stop();          // posts WM_QUIT to a listener THREAD ID...
        capture.begin();          // ...which Windows may have already recycled
    }                             //    onto the thread this just spawned
}
```

## RIGHT

```rust
/// One hook, two consumers. A relaxed atomic decides which one gets the edge.
pub struct CaptureTap {
    on: AtomicBool,
    seen: AtomicU64,          // observability: see NOTES
    tx: Sender<CaptureEvent>,
}

impl CaptureTap {
    /// Called from the hook callback: two relaxed atomics and a channel send.
    /// No lock, no allocation, no I/O -- Windows silently unhooks a callback
    /// that overruns LowLevelHooksTimeout.
    fn forward(&self, key: KeyCode, down: bool) -> bool {
        if !self.on.load(Ordering::Relaxed) {
            return false;
        }
        self.seen.fetch_add(1, Ordering::Relaxed);
        let _ = self.tx.send(CaptureEvent { key, down });
        true   // consumed: the caller skips the tracker
    }
}

unsafe extern "system" fn keyboard_hook(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
    // ... map the vk ...
    let disconnected = match state {
        // Recording: the raw edge goes to the UI and the tracker never sees
        // it, so the chord being recorded cannot also fire the hotkey action.
        HookState::Ptt { tap, .. } if !injected && tap.forward(key, down) => false,
        HookState::Ptt { tracker, tx, .. } => { /* normal chord handling */ }
    };
    unsafe { CallNextHookEx(None, code, w, l) }
}
```

The UI flips `on` instead of installing anything, and the first hook is never
torn down:

```rust
// Arm: drain stale edges first, or a leftover release completes a "chord"
// the user never pressed.
pub fn arm_capture(&mut self) -> Option<(Arc<CaptureTap>, Receiver<CaptureEvent>)> {
    let tap = self.tap.clone()?;
    let rx = self.capture_rx.take()?;
    while rx.try_recv().is_ok() {}
    tap.seen.store(0, Ordering::Relaxed);
    tap.on.store(true, Ordering::Relaxed);
    Some((tap, rx))
}
```

## NOTES

- **Cost is one `Relaxed` load per key event.** Relaxed is sufficient on both
  ends: the worst a stale read does is route one edge to the wrong consumer
  either side of the flip, and the user is not pressing keys at the microsecond
  they click "Record".
- **Never take a lock in the branch.** A `Mutex` around an optional sender is
  the tempting way to swap consumers, but a low-level hook callback that blocks
  is a callback Windows removes. If you must, `try_lock` only.
- **While the tap is armed, skip the primary consumer entirely.** Otherwise the
  chord the user is recording also fires the action it is bound to.
- **Never tear down hook A to install hook B.** Teardown is normally
  `PostThreadMessageW(thread_id, WM_QUIT, ..)`, and thread ids are recycled
  aggressively -- a freshly spawned thread is a prime candidate -- so the quit
  meant for the old hook can land on the new one. If you cannot avoid the
  sequence, complete the stop (post *and* join) before spawning anything, and
  gate the post on a liveness flag the hook thread clears on its way out so you
  never post to an id that is no longer yours.
- **Count what the callback forwards and put it on screen.** "I press keys and
  nothing happens" has two completely different causes -- the hook never sees
  them, or it sees them and the consumer loses them. A counter separates them
  in one glance instead of costing another release to find out.
- Keep the second-hook path only for the case with nothing to tap (the primary
  hook is not running at all), and log which path was taken.
- Related: `chord-tracker-missed-release.md` (same `WH_KEYBOARD_LL` family),
  `gui-subsystem-console-child-window.md` (Windows tray-app family).
