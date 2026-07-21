---
tech: rust
tags: [egui, eframe, winit, viewport, multi-monitor, dpi, windows, overlay]
severity: high
---
# egui's monitor_size cannot position a window: no monitor origin, no per-monitor DPI

## PROBLEM

`ctx.input(|i| i.viewport().monitor_size)` returns a **size and nothing else**. egui
exposes no monitor origin and no per-monitor scale factor anywhere in its API, so any
position computed from it silently assumes two things:

1. the current monitor's top-left is `(0, 0)`, and
2. that monitor shares the primary monitor's DPI.

`ViewportBuilder::with_position` is in **virtual-desktop coordinates** (origin = top-left
of the *primary* monitor), and egui hands it to winit as a `LogicalPosition`
(`LogicalPosition::new(zoom_factor * pos.x, ...)`), which winit resolves to physical
pixels using the scale factor it guesses *before the window belongs to any monitor*.

On a single display both assumptions happen to hold, so this looks correct forever. On a
multi-monitor desktop -- especially mixed scaling -- the window lands on the wrong monitor
or in the dead space between monitors.

The failure is silent and expensive to debug: the viewport is registered, the OS window is
created, and the UI callback paints it every frame at 60 fps. Nothing errors, nothing logs,
CPU looks normal -- the window simply sits at coordinates no monitor covers. Chasing it
through egui/eframe viewport internals (`run_ui` visibility gating, deferred-viewport GC in
`end_pass`, `remove_viewports_not_in`) turns up nothing, because none of that is wrong.

It also presents as a phantom regression. eframe's `persistence` feature remembers window
geometry, so a fresh install resets which monitor the parent window restores onto, changing
`current_monitor()` and with it the computed position. The overlay "breaks in the new build"
with a byte-identical code path and identical egui/eframe/winit versions in the lockfile.

egui's own `ViewportCommand::center_on_screen` makes the same assumption, so it is not a
usable workaround.

## WRONG

```rust
// Position derived from a size with no origin and no DPI.
let monitor = ctx.input(|i| i.viewport().monitor_size);
if let Some(monitor) = monitor {
    let x = (monitor.x - WINDOW.x) / 2.0;
    let y = monitor.y - WINDOW.y - monitor.y * BOTTOM_MARGIN_FRAC;
    // Virtual-desktop coordinates, converted with a guessed scale factor:
    // lands off-screen whenever the current monitor is not the primary,
    // or runs at a different scaling level.
    builder = builder.with_position(egui::pos2(x.max(0.0), y.max(0.0)));
}
ctx.show_viewport_deferred(id, builder, move |ui, _| paint(ui));
```

## RIGHT

```rust
// Create the window with no position, then place it from real OS geometry
// inside the viewport's own frame, where the window actually exists.
ctx.show_viewport_deferred(id, builder, move |ui, _| {
    #[cfg(windows)]
    reposition(ui.ctx());
    paint(ui);
});

/// ViewportCommand::OuterPosition is applied as `pixels_per_point * pos`
/// (pixels_per_point = zoom_factor * window.scale_factor()), so dividing by
/// this window's own pixels_per_point round-trips to the exact physical pixel
/// no matter which monitor the window currently sits on.
#[cfg(windows)]
fn reposition(ctx: &egui::Context) {
    let Some(target) = work_area_position(ctx.zoom_factor()) else {
        return; // no geometry: leave it where the OS put it
    };
    let ppp = ctx.pixels_per_point();
    // Compare against the live outer_rect, not a cached "already placed" flag:
    // a window recreated later must be placed again, not just the first one.
    let placed = ctx.input(|i| i.viewport().outer_rect).is_some_and(|r| {
        (r.min.x * ppp - target.x).abs() <= 2.0 && (r.min.y * ppp - target.y).abs() <= 2.0
    });
    if placed {
        return;
    }
    ctx.send_viewport_cmd(egui::ViewportCommand::OuterPosition(egui::pos2(
        target.x / ppp,
        target.y / ppp,
    )));
}

/// Top-left in physical desktop pixels, from the work area (taskbar excluded)
/// of the monitor holding the foreground window.
#[cfg(windows)]
fn work_area_position(zoom: f32) -> Option<egui::Pos2> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, MONITORINFO,
        MONITOR_DEFAULTTOPRIMARY,
    };
    use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    let monitor = unsafe {
        let foreground = GetForegroundWindow();
        if foreground.is_invalid() {
            MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY)
        } else {
            MonitorFromWindow(foreground, MONITOR_DEFAULTTOPRIMARY)
        }
    };

    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        return None;
    }
    let work = info.rcWork; // real desktop coordinates, origin included

    // Per-monitor DPI, not the process or primary DPI: this is exactly what
    // differs across a mixed-scaling desktop.
    let (mut dpi_x, mut dpi_y) = (96_u32, 96_u32);
    unsafe { GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) }.ok()?;
    let scale = zoom * dpi_x as f32 / 96.0;

    let (window_w, window_h) = (WINDOW.x * scale, WINDOW.y * scale);
    let work_w = (work.right - work.left) as f32;
    let work_h = (work.bottom - work.top) as f32;
    Some(egui::pos2(
        work.left as f32 + (work_w - window_w) / 2.0,
        work.bottom as f32 - window_h - work_h * BOTTOM_MARGIN_FRAC,
    ))
}
```

## NOTES

- Verified against egui/eframe 0.35, winit 0.30.13 (2026-07-21). Found in Hark 0.18.1,
  `crates/hark-app/src/overlay.rs`: an always-on-top push-to-talk indicator that stopped
  being visible on a two-monitor mixed-DPI Windows desktop.
- **Anchor to the foreground window, not the parent window.** For an overlay built with
  `with_active(false)`, the foreground window is still the app the user is working in, which
  is the monitor they are looking at. The parent window may be hidden in a tray on another
  monitor entirely.
- **`rcWork`, not `rcMonitor`**: `rcWork` excludes the taskbar, so a bottom-anchored overlay
  does not sit under it.
- Positioning must happen from *inside* the child viewport's frame. At
  `ViewportBuilder` time the window does not exist yet, so there is no scale factor to
  convert against -- that is the root of the builder-path bug.
- Related: [eframe-034-app-trait-split.md](eframe-034-app-trait-split.md) for `logic()` vs
  `ui()` (a deferred viewport registered from `logic` keeps working while the parent window
  is hidden), and [egui-companion-crate-lag.md](egui-companion-crate-lag.md).
- Cross-compiling `cargo clippy --target x86_64-pc-windows-msvc` type-checks and lints
  `cfg(windows)` code from Linux/macOS as long as no C dependency in the graph needs the MSVC
  toolchain. If one does, copy the module into a scratch crate with only the pure-Rust deps
  (`windows`, `egui`) and check that -- otherwise the Windows-only path ships unverified.
