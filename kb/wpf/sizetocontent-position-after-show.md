---
tech: wpf
tags: [window, sizetocontent, positioning, dpi, tray, popup]
severity: high
---
# SizeToContent window positioned after Show() lands at the default cascade spot on first show

## PROBLEM
A `Window` with `SizeToContent="WidthAndHeight"` does not have its final
`ActualWidth`/`ActualHeight` when `Show()` returns. The size settles slightly
later (content layout plus the per-monitor DPI pass that fires on first
render). If you position the window by setting `Left`/`Top` right after
`Show()`, the math runs against a stale size or the position gets overridden
by the DPI adjustment, and the window appears at the Windows default cascade
position (top-left area) instead of where you put it.

The failure is first-show only: on later `Show()` calls the window already has
its final size and last position, so the same code works. This makes it look
intermittent and easy to misdiagnose as a multi-monitor or WorkArea issue.

Typical victim: a tray flyout / popup window meant to anchor at the
bottom-right of the work area, which opens "in some crazy spot" the first
time and correctly every time after.

## WRONG
```csharp
private void ShowFlyout()
{
    _window ??= BuildWindow();          // SizeToContent = WidthAndHeight
    var work = SystemParameters.WorkArea;
    _window.Show();
    _window.UpdateLayout();             // not enough on first show
    _window.Left = work.Right - _window.ActualWidth - 8;
    _window.Top = work.Bottom - _window.ActualHeight - 8;
}
```

## RIGHT
```csharp
// 1. Give the window an explicit rough position before it is ever shown,
//    so the first frame never flashes at the cascade spot.
var window = new Window
{
    SizeToContent = SizeToContent.WidthAndHeight,
    WindowStartupLocation = WindowStartupLocation.Manual,
    Left = SystemParameters.WorkArea.Right - EstimatedWidth,
    Top = SystemParameters.WorkArea.Bottom - EstimatedHeight,
    // ...
};

// 2. Re-anchor whenever the size actually settles (covers the late
//    layout/DPI resize on first show).
window.SizeChanged += (_, _) =>
{
    if (window.IsVisible)
        PositionNearTray();
};

private void PositionNearTray()
{
    if (_window == null || _window.ActualWidth == 0)
        return;
    var work = SystemParameters.WorkArea;
    _window.Left = work.Right - _window.ActualWidth - 8;
    _window.Top = work.Bottom - _window.ActualHeight - 8;
}
```

## NOTES
- `UpdateLayout()` after `Show()` is not sufficient; the per-monitor DPI
  resize can still arrive after it and move/resize the window.
- The `SizeChanged` handler is the reliable hook: it fires after the final
  size is known, every time it changes, so the window always snaps back to
  its anchor.
- Guard on `ActualWidth == 0` so the handler is a no-op before first layout.
- Found fixing the tray flyout in DeafDirectionalHelper (2026-07): first
  right-click on the tray icon opened the menu at top-left; every later
  open was correct.
