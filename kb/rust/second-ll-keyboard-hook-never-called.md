---
tech: rust
tags: [windows, wh_keyboard_ll, setwindowshookex, low-level-hook, getasynckeystate, input, hotkey, win32, silent-failure, focus]
severity: high
---
# A WH_KEYBOARD_LL hook can stop being called while your OWN window has focus

## PROBLEM

A process installs a low-level keyboard hook on a dedicated message-pumping thread. It
works — until the process's own window is focused, at which point the callback stops being
invoked for keys the user is pressing. `SetWindowsHookExW` returned a valid `HHOOK`, the
thread is alive in `GetMessageW`, `GetLastError` is clean, and the hook is still registered.
Nothing reports a problem.

**This was measured, not theorised.** An instrumented build counted edges by source while
recording a keyboard shortcut, and logged one line per recording:

```
shortcut recorded: 0 edges from the hook, 4 from the scanner
shortcut recorded: 0 edges from the hook, 8 from the scanner
shortcut recorded: 0 edges from the hook, 22 from the scanner
shortcut recorded: 41 edges from the hook, 16 from the scanner   <-- this one unfocused
```

Zero. The hook delivered nothing at all while the app's own window had focus, and delivered
normally the moment focus was elsewhere. A `GetAsyncKeyState` poller running alongside it
saw every key the whole time.

The trap is that **every diagnostic reports healthy**, and the one documented failure mode
(the installing thread has no message loop) is satisfied. Worse, the symptom is easy to
misattribute:

- The same hook can be *working* for another consumer in the same process, because that
  consumer is exercised while the window is NOT focused. A push-to-talk listener is used to
  dictate *into other apps*; a settings screen that records a shortcut is used with the
  settings window focused. One works, one does not, from a single shared callback — which
  makes it look like a bug in whatever differs between the two consumers.
- Installing a SECOND hook for the second consumer looks like it "is never called", when in
  fact it is the same focus condition, tested from the settings window every time.
- Downstream code faithfully reconstructs a *fragment*: a lost key-down with its key-up
  delivered turns a two-key combination into a one-key one, silently, and the bug presents
  as "the recorder ignores my combination" rather than "events are missing".

No documented Win32 mechanism explains it. Every documented gate on low-level hook delivery
is desktop, integrity level, `LowLevelHooksTimeout`, or an earlier hook returning nonzero —
none of which is focus-dependent, and none of which would spare a *different* consumer of
the same callback. Do not spend days looking for the mechanism. Assume the hook is not a
complete record of the keyboard and design accordingly.

## WRONG

```rust
// The only source of truth about what is held is the hook callback.
unsafe extern "system" fn keyboard_hook(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
    if code >= 0 {
        let info = unsafe { &*(l.0 as *const KBDLLHOOKSTRUCT) };
        if let Some(key) = vk_to_key(info.vkCode) {
            let down = !info.flags.contains(LLKHF_UP);
            let _ = TX.send(KeyEdge { key, down });   // if this never fires, nothing knows
        }
    }
    unsafe { CallNextHookEx(None, code, w, l) }
}

// ...and the consumer rebuilds state purely from that stream, so one missing
// key-down silently yields a chord the user never pressed.
fn on_edge(&mut self, key: KeyCode, down: bool) -> Option<Chord> {
    if down { self.held.push(key); self.down.push(key); return None }
    self.down.retain(|k| *k != key);
    if self.down.is_empty() { Some(Chord::from(take(&mut self.held))) } else { None }
}
```

## RIGHT

```rust
/// Poll real key state alongside the hook and emit the SAME edge type. Either
/// source alone is enough, so a hook that goes quiet costs nothing.
pub struct HeldScan { down: u64, stale: u64 }   // bit i = KEYS[i]

impl HeldScan {
    /// Baseline: keys already held when polling starts are marked stale and
    /// emit nothing until released once. GetAsyncKeyState reports ABSOLUTE
    /// physical state, including keys pressed before the process started.
    pub fn new(mut is_down: impl FnMut(KeyCode) -> bool) -> HeldScan {
        let mut down = 0u64;
        for (i, k) in KEYS.iter().enumerate() { if is_down(*k) { down |= 1 << i } }
        HeldScan { down, stale: down }
    }

    pub fn tick(&mut self, mut is_down: impl FnMut(KeyCode) -> bool,
                mut emit: impl FnMut(KeyEdge)) {
        for (i, key) in KEYS.iter().enumerate() {
            let (bit, now) = (1u64 << i, is_down(*key));
            if now == (self.down & bit != 0) { continue }
            if now { self.down |= bit; emit(KeyEdge { key: *key, down: true }) }
            else {
                self.down &= !bit;
                // A stale key's first release is swallowed, then it behaves normally.
                if self.stale & bit != 0 { self.stale &= !bit }
                else { emit(KeyEdge { key: *key, down: false }) }
            }
        }
    }
}

fn physically_down(key: KeyCode) -> bool {
    // High bit is physical state; the low bit is the CapsLock-style toggle.
    let s = unsafe { GetAsyncKeyState(i32::from(key_to_vk(key).0)) };
    (s as u16) & 0x8000 != 0
}
```

Make duplicates free so the two sources need no merge layer: the consumer must ignore a
repeated press and a release of a key it is not tracking. Then interleaving hook edges and
polled edges in any order yields the same result.

**Count the sources separately and show it.** This is what turns a multi-release guessing
game into one measurement:

```rust
pub struct Counts { pub hook: u64, pub polled: u64 }
```

## NOTES

- **Poll from a dedicated thread, never from the hook callback.** MSDN: the async key state
  is not yet updated for the key currently being delivered, so a poll inside the callback
  reads stale state. It also violates the "keep the callback lean" rule that
  `LowLevelHooksTimeout` enforces.
- **Never feed polled state into a "start the action" path.** Heal releases, never presses:
  a press synthesized from a poll would fire the hotkey for a chord the user was already
  holding when polling began. Polling is for *recording* a shortcut, not for triggering one.
- Poll cost is trivial — `GetAsyncKeyState` is a user-mode read; ~100 keys every 15 ms is
  well under a millisecond per second of wall clock.
- **`GetAsyncKeyState` returning 0 is ambiguous**: "key is up" AND "call failed" (non-active
  desktop, UIPI, missing `DESKTOP_HOOKCONTROL`). A UAC prompt stealing focus makes every key
  read up at once, so a poller must tolerate a spurious mass-release.
- At medium integrity with a HIGH integrity window focused, the hook and `GetAsyncKeyState`
  go dark together. Polling is not a workaround for UIPI.
- Related: `chord-tracker-missed-release.md` (a missed release in the same subsystem),
  `gui-subsystem-console-child-window.md` (Windows tray-app family).
