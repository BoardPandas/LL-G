---
tech: rust
tags: [windows, wh_keyboard_ll, hotkey, chord, getasynckeystate, low-level-hook, input, push-to-talk, state-machine]
severity: high
---
# A hotkey chord tracker fed only by hook callbacks demotes itself to a single key on one missed release

## PROBLEM

A multi-key hotkey ("hold LCtrl+F12") is normally tracked with a per-member
`held` array: set `true` on key-down, `false` on key-up, fire when all members
are `true`. The array's only input is the OS hook callback -- and a low-level
keyboard hook does **not** deliver every release:

- **Fn-layer keyboards** report an F-key *break* under a different virtual-key
  than the *make* (release Fn before F12 and the F12 up-event never arrives as
  F12). This is the common case and it is per-keyboard, so it never reproduces
  on the developer's machine.
- Releases that happen on **another desktop** -- lock screen, UAC consent,
  Ctrl+Alt+Del -- are delivered to that desktop's hook, not yours.
- Releases **across sleep/resume**, or after Windows silently unhooks a
  callback that exceeded `LowLevelHooksTimeout`, are simply lost.

Miss one release and that member stays `true` forever. The chord is now
satisfied by whatever keys remain: with `LCtrl+F12` configured and F12 stuck,
**pressing Left Ctrl alone fires the hotkey**. For a push-to-talk app that
means the microphone opens on a bare modifier -- silently, permanently, and
only for some users.

The usual defence does not cover this. A watchdog timer that polls
`GetAsyncKeyState` to heal a lost release is armed **only between engage and
disengage** (that is the case it was written for: a hold that never ends). A
release lost *after* the chord has already disengaged happens with the watchdog
disarmed, so nothing is polling and nothing ever clears the stale member.

Symptom shape: the hotkey works correctly, then permanently degrades to a
subset of itself mid-session. Restarting fixes it (the tracker is rebuilt), so
it reads as a flaky one-off rather than a state bug.

## WRONG

```rust
pub struct ChordTracker {
    chord: PttChord,
    member_down: Vec<bool>,
    engaged: bool,
}

impl ChordTracker {
    /// Fed from the WH_KEYBOARD_LL callback. The tracker's own `member_down`
    /// is the ONLY source of truth about what is held.
    pub fn on_event(&mut self, key: PttKeyCode, down: bool) -> Option<PttEvent> {
        let idx = self.chord.keys().iter().position(|k| *k == key)?;
        if self.member_down[idx] == down {
            return None; // auto-repeat
        }
        self.member_down[idx] = down;

        // If F12's release was never delivered, member_down[F12] is still true
        // and a bare LCtrl press satisfies this.
        let all_down = self.member_down.iter().all(|d| *d);
        match (self.engaged, all_down) {
            (false, true) => { self.engaged = true; Some(PttEvent::Down) }
            (true, false) => { self.engaged = false; Some(PttEvent::Up) }
            _ => None,
        }
    }

    /// Heals a lost release -- but the timer driving it is armed only while
    /// `engaged`, so it never sees a release lost after disengage.
    pub fn resync_released(&mut self, mut down: impl FnMut(PttKeyCode) -> bool) -> Option<PttEvent> {
        if !self.engaged { return None; }
        // ...
        # None
    }
}
```

## RIGHT

```rust
impl ChordTracker {
    /// `physically_down` is the platform's answer (GetAsyncKeyState's high
    /// bit on Windows). Consulted for the OTHER members only, and only on a
    /// press that is about to engage -- the single point where a stale `true`
    /// can start an action.
    pub fn on_event_verified(
        &mut self,
        key: PttKeyCode,
        down: bool,
        mut physically_down: impl FnMut(PttKeyCode) -> bool,
    ) -> Option<PttEvent> {
        let idx = self.chord.keys().iter().position(|k| *k == key)?;
        if self.member_down[idx] == down {
            return None;
        }
        self.member_down[idx] = down;

        if down && !self.engaged && self.member_down.iter().all(|d| *d) {
            for (i, member) in self.chord.keys().iter().enumerate() {
                // Skip `idx`: a low-level hook runs BEFORE the platform's key
                // state updates, so the key in this very event still reads up.
                if i != idx && !physically_down(*member) {
                    log::warn!("chord member {member} was marked held but is up; ignoring");
                    self.member_down[i] = false;
                }
            }
        }

        let all_down = self.member_down.iter().all(|d| *d);
        match (self.engaged, all_down) {
            (false, true) => { self.engaged = true; Some(PttEvent::Down) }
            (true, false) => { self.engaged = false; Some(PttEvent::Up) }
            _ => None,
        }
    }
}

/// The high bit is the physical state; the low bit is the CapsLock-style
/// toggle and must be masked off.
fn physically_down(key: PttKeyCode) -> bool {
    let state = unsafe { GetAsyncKeyState(i32::from(key_to_vk(key).0)) };
    (state as u16) & 0x8000 != 0
}
```

## NOTES

- **Clear members, never set them.** Promoting a member to `true` from a poll
  would let a chord the user was already holding before the hook existed fire
  an action nobody asked for -- the same asymmetry `resync_released` relies on.
- **Never poll the key in the current event.** A low-level hook callback runs
  before the input reaches the system's key-state table, so `GetAsyncKeyState`
  for the key going down still reports up. Poll only the *other* members.
- **Cost is negligible and correctly placed.** At most N-1 key-state reads,
  only on the press that would engage. `GetAsyncKeyState` is a cheap user-mode
  read, which matters because a `WH_KEYBOARD_LL` callback that exceeds
  `LowLevelHooksTimeout` is silently unhooked by Windows -- which is itself one
  of the ways a release goes missing, so a heavyweight check here would feed
  the bug it is meant to fix.
- Keep the pure `on_event(key, down)` as a thin wrapper delegating with
  `|_| true` so the edge-semantics unit tests stay platform-free.
- The same reasoning applies to any held-key state machine driven by an
  event stream that can drop events: game input rebinding, MIDI note-off,
  gamepad chords. Verify at the edge that commits, not on every event.
- Related: `gui-subsystem-console-child-window.md` (same `WH_KEYBOARD_LL` /
  Windows tray-app family).
