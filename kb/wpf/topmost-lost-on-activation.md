---
tech: wpf
tags: [topmost, overlay, zorder, setwindowpos, transparency, win32]
severity: high
---
# Topmost=True can silently lose its Win32 z-band; the WPF property still reads True

## PROBLEM
A WPF overlay window created with `Topmost = true`, `AllowsTransparency = true`
and shown non-activated (`ShowActivated = false`) can fall out of the Win32
topmost band when the same app later shows and activates another window (e.g.
a settings window at startup). The overlay drops behind normal windows and
"disappears" on a busy desktop. Crucially, `window.Topmost` still returns
`true` and `IsVisible`/`Opacity` look healthy - WPF's property is a cached
value, not the live z-order, so logging shows nothing wrong.

The bug often looks "self-healing": any later change to `Left/Top/Width/Height`
makes WPF call `SetWindowPos`, which re-asserts `HWND_TOPMOST` and the overlay
pops back - masking the root cause.

## WRONG
```csharp
var overlay = new OverlayWindow { Topmost = true, ShowActivated = false };
overlay.Show();
// ... later, same app:
settingsWindow.Show();
settingsWindow.Activate();   // overlay silently drops below normal windows
```

## RIGHT
```csharp
[DllImport("user32.dll")]
static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
static readonly IntPtr HWND_TOPMOST = new(-1);
const uint SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOACTIVATE = 0x10;

void ReassertTopmost(Window w)
{
    var hwnd = new WindowInteropHelper(w).Handle;
    if (hwnd != IntPtr.Zero)
        SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
}

// 1) right after showing the overlay
// 2) whenever another app window is activated (settingsWindow.Activated += ...)
// 3) belt-and-braces: on a slow cadence (every ~2 s) from the overlay's render tick
```

## NOTES
- `Topmost = false; Topmost = true;` also works but flickers the z-order;
  direct `SetWindowPos` with `SWP_NOACTIVATE` is cleaner.
- Likely aggravated by `SetWindowLong(GWL_EXSTYLE, ... | WS_EX_TRANSPARENT)`
  click-through style changes between Show and the other window's activation.
- Found in DeafDirectionalHelper: radar-ring overlay vanished when the settings
  shell opened at launch; clicking any setting "fixed" it because ApplySettings
  set window bounds (2026-07).
