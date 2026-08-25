---
tech: windows
tags: [openinputdesktop, setthreaddesktop, winlogon, secure-desktop, screen-capture, bitblt, sendinput, remote-control, session-0, dxgi]
severity: high
---
# OpenInputDesktop(GENERIC_ALL) is refused on Winlogon, and every consumer of the stale attachment then fails silently

## PROBLEM

A Windows session has several desktops (`Default`, `Winlogon`, `Screen-saver`) and only one owns input at a time. Three APIs are desktop-affine, and not one of them fails loudly when the calling thread is attached to the wrong one:

- `BitBlt` of a desktop nobody is signed into returns `TRUE` and a valid, entirely black frame.
- `SendInput` returns the number of events sent, for events that desktop never delivers.
- `IDXGIOutput1::DuplicateOutput` returns `E_ACCESSDENIED`, which is byte for byte what a genuine UAC prompt produces, so it reads as an expected condition rather than a bug.

Two things then compound into a fault that survives for days.

First, the access mask. `OpenInputDesktop(0, FALSE, GENERIC_ALL)` works perfectly against `Default`, which is what a developer tests on. `GENERIC_ALL` maps to include `WRITE_DAC`, `WRITE_OWNER` and `DELETE`, and the `Winlogon` desktop grants those to nobody, SYSTEM included. So the call succeeds in every test and fails precisely at the lock screen, the sign-in screen and every UAC elevation, which is exactly when a remote-support session is most needed.

Second, the usual handling of that failure. "Could not open the input desktop, keep the current attachment and retry next frame" looks defensive and is catastrophic: the thread stays on `Default` forever while the machine sits on `Winlogon`, and all three APIs above go on reporting success. The result is a session that is connected, reports itself healthy, streams a perfectly valid all black picture, and accepts and discards every click.

The log is actively misleading. A DXGI capture thread that never followed the desktop reports "output duplication denied, a secure desktop is active" while the GDI capture thread cheerfully reports it is attached to `Default`. Both lines are true statements about different threads, they cannot both describe the machine, and neither is wrong enough to look like a bug.

## WRONG

```c
// Asks for rights Winlogon will never grant, so this succeeds on Default
// and fails at exactly the moment the picture matters.
HDESK desk = OpenInputDesktop(0, FALSE, GENERIC_ALL);
if (!desk) {
    // "Between a lock and the sign-in screen there is a window with no input
    // desktop. Keep what we have and try again next frame."
    if (current) return S_OK;   // <-- the whole incident lives on this line
    return HRESULT_FROM_WIN32(GetLastError());
}
SetThreadDesktop(desk);
```

```c
// And the consumers, each of which succeeds against the wrong desktop:
BitBlt(mem, 0, 0, w, h, screen, 0, 0, SRCCOPY);  // TRUE, all-black bitmap
SendInput(1, &click, sizeof(INPUT));             // returns 1, nothing happens
hr = output1->DuplicateOutput(device, &dup);     // E_ACCESSDENIED, blamed on UAC
```

## RIGHT

```c
// 1. Fall back to the rights you actually use. READOBJECTS + WRITEOBJECTS
//    plus the journal/hook rights SendInput's synthesized events travel on
//    is what Winlogon will grant.
#define DESKTOP_CAPTURE_AND_INPUT ( \
    DESKTOP_READOBJECTS | DESKTOP_WRITEOBJECTS | DESKTOP_ENUMERATE | \
    DESKTOP_CREATEWINDOW | DESKTOP_CREATEMENU | DESKTOP_HOOKCONTROL | \
    DESKTOP_JOURNALRECORD | DESKTOP_JOURNALPLAYBACK | DESKTOP_SWITCHDESKTOP)

static const DWORD attempts[] = { GENERIC_ALL, DESKTOP_CAPTURE_AND_INPUT };

HDESK desk = NULL;
for (int i = 0; !desk && i < ARRAYSIZE(attempts); i++)
    desk = OpenInputDesktop(0, FALSE, attempts[i]);

// 2. Fail closed. A capture or an injection on a thread that could not reach
//    the input desktop must return an error, not a black frame, because a
//    black frame is indistinguishable from a real one.
if (!desk)
    return E_DESKTOP_UNREACHABLE;   // your own sentinel; refuse the frame

// 3. Log the transition, not the attempt. This runs at the frame rate.
if (SetThreadDesktop(desk)) { /* log only when the name or staleness changed */ }
```

```go
// Every thread that touches a desktop-affine API needs its own attachment,
// including the COM thread DXGI Desktop Duplication runs on. Threads inherit
// the process's startup desktop (STARTUPINFO.lpDesktop) and never follow it
// afterwards, so a worker created once at startup is on the wrong desktop for
// the entire remainder of a session.
//
// Encoder threads deliberately do NOT get this: an encoder does not read the
// screen, and binding it to a desktop makes encoding fail on a locked machine
// for no reason.
```

## NOTES

- `STARTUPINFO.lpDesktop = "WinSta0\\Default"` on `CreateProcessAsUser` only sets where the process *starts*. It says nothing about which desktop owns input later, and threads do not follow it.
- Attaching to `Winlogon` requires SYSTEM. If the host runs as the signed-in user it cannot reach the secure desktop at all, and the honest outcome is an explicit "cannot reach the input desktop" reported to the operator, never a black frame.
- `SetThreadDesktop` fails if the calling thread owns any window or hook, so attach before creating graphics resources on that thread where you can, and treat the failure as its own distinct error.
- Diagnosis tip: `LogonUI.exe` running means the lock screen is up. If your capture host simultaneously reports it is on `Default`, that contradiction is the bug, and it is the only signal you will get.
- Do not try to detect this by inspecting pixels. A genuinely black screen is legitimate; the reliable signal is the attachment state, not the image.
- The DXGI half of this is easy to misattribute for a long time, because `E_ACCESSDENIED` from `DuplicateOutput` has a real and common cause (an actual secure desktop) that is indistinguishable from "this thread was never on the right desktop".
