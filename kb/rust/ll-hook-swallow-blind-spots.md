---
tech: rust
tags: [windows, wh_keyboard_ll, setwindowshookex, numlock, low-level-hook, input, hotkey, win32, callnexthookex]
severity: medium
---
# Swallowing from a WH_KEYBOARD_LL hook has blind spots: Num Lock and the Alt/Win menu mask

## PROBLEM

Returning a nonzero `LRESULT` from a `LowLevelKeyboardProc` instead of calling
`CallNextHookEx` discards the event, and that is normally total — the target window, other
hooks, `RegisterHotKey`, and Raw Input all never see it. So it is natural to assume you can
suppress *any* key this way.

Two documented exceptions bite, and both fail quietly.

**1. Num Lock's toggle is applied ABOVE the hook.** Suppress `VK_NUMLOCK` and the keystroke
is eaten *and the lock still flips*. You get the cost with none of the benefit. This is why
PowerToys' Keyboard Manager cannot simply swallow it and instead re-applies the previous
state with `SendInput` (`SetNumLockToPreviousState`, PowerToys PR #4083 and the
`keyboardmanager` devdocs). Caps Lock and Scroll Lock do *not* behave this way — their
toggle rides the make code the hook can intercept — so a suppression feature that works
perfectly on those silently does nothing on Num Lock, and the asymmetry is invisible until
someone tests all three.

**2. A swallowed key cannot mask the Alt/Win menu.** Windows pops the menu bar on a lone
Alt release, and the Start menu on a lone Win release, *unless* it saw another key go down
while the modifier was held. A key you swallowed is invisible to that check — the system
never saw it — so `Alt + X` with `X` suppressed behaves like a bare Alt tap and pops the
menu bar every time. AutoHotkey hits exactly this and works around it with a mask keystroke
(`#MenuMaskKey`), which means injecting input globally: a far larger blast radius than the
single return path you were trying to add.

The trap in both cases is that the feature *looks* implemented. The code is reached, the
branch is taken, the return value is right — and the observable behaviour is either
unchanged (Num Lock) or newly broken somewhere unrelated (a menu popping on every use).

## WRONG

```rust
unsafe extern "system" fn keyboard_hook(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
    if code >= 0 {
        let info = unsafe { &*(l.0 as *const KBDLLHOOKSTRUCT) };
        // "Suppress the lock keys so our shortcut doesn't toggle them."
        if matches!(info.vkCode, VK_CAPITAL | VK_NUMLOCK | VK_SCROLL) && chord_is_engaged() {
            return LRESULT(1);   // Num Lock: keystroke eaten, lock toggles anyway.
        }
    }
    unsafe { CallNextHookEx(None, code, w, l) }
}
```

...and the same hook, for a chord like `Alt+X`:

```rust
if chord_contains_alt() && key == chord_key && down {
    return LRESULT(1);   // Windows never saw X, so Alt looks like a bare tap:
}                        // the menu bar opens on every single use.
```

## RIGHT

Decide what is suppressible up front, as data, and exclude the rest by construction:

```rust
impl KeyCode {
    /// The locks whose toggle a low-level hook can actually stop.
    /// Num Lock is absent on purpose: Windows applies its toggle ABOVE the
    /// hook, so suppressing it eats the keystroke and flips the lock anyway.
    pub const fn is_suppressible_lock(self) -> bool {
        matches!(self, KeyCode::CapsLock | KeyCode::ScrollLock)
    }

    /// Alt and Win pop a menu on release unless Windows saw another key go
    /// down while they were held. A swallowed key is invisible to that check,
    /// so never suppress inside a chord containing one.
    pub const fn is_menu_modifier(self) -> bool {
        matches!(self, KeyCode::LAlt | KeyCode::RAlt | KeyCode::LWin | KeyCode::RWin)
    }
}

/// Resolved ONCE from the chord, not per keystroke: no per-press state to
/// strand, and a stuck key is not representable.
fn suppressible_member(chord: &Chord) -> Option<usize> {
    if chord.keys().len() < 2 { return None }                          // a lone lock key stays a lock key
    if chord.keys().iter().any(|k| k.is_menu_modifier()) { return None }
    let mut found = None;
    for (i, k) in chord.keys().iter().enumerate() {
        if k.is_suppressible_lock() {
            if found.is_some() { return None }                          // two locks: no truthful anchor left
            found = Some(i);
        }
    }
    found
}
```

## NOTES

- **Key-DOWN only.** A lock's toggle rides the make code, so suppressing the break buys
  nothing — and a swallowed release is the only way to leave a key stuck from the system's
  point of view. Down-only makes that state unrepresentable.
- **Never suppress a chord of one key.** "All the *other* members are held" is vacuously
  true when there are none, so a lone-`CapsLock` binding would swallow Caps Lock globally
  and permanently, with no way back from inside the app.
- **A suppressed key never updates the async key state.** Anything that polls
  `GetAsyncKeyState` to detect a missed release will read that key as up for the whole
  hold. In a push-to-talk app that meant a watchdog firing a bogus "release missed" a
  quarter-second into every use. Exempt the suppressed key from the poll, and keep at
  least one non-suppressed member so the poll still has something truthful to read.
- **Gate the whole thing on measuring that `LRESULT(1)` stops the toggle at all** on real
  hardware — check the LED *and* `GetKeyState(vk) & 1`. If it does not, the feature is a
  no-op that eats a keystroke.
- Hook-chain order is not deterministic across machines: another hook registered earlier
  can consume the event before yours, so suppression is best-effort in the presence of
  PowerToys, AutoHotkey, or an overlay.
- Accessibility cost worth stating out loud: screen readers commonly use Caps Lock as their
  modifier (NVDA's laptop layout), so suppressing it takes that away.
- Related: `second-ll-keyboard-hook-never-called.md`, `chord-tracker-missed-release.md`.
