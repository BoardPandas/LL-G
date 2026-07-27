---
tech: rust
tags: [winit, egui, eframe, windows, win32, borderless, setwindowrgn, dwm, ws_caption, overlay]
severity: high
---
# winit's with_decorations(false) keeps WS_CAPTION, so a window region makes Windows paint caption buttons

## PROBLEM

winit (0.30.x) does not undecorate a window by removing its styles. Every window it
creates keeps `WS_CAPTION | WS_BORDER | WS_SYSMENU` plus `WS_MINIMIZEBOX` /
`WS_MAXIMIZEBOX` -- the source comment calls them "required styles to properly support
common window functionality like aero snap". Undecoration is achieved *only* by
overriding `WM_NCCALCSIZE` to collapse the non-client area, and that override bails out
to `DefWindowProc` whenever `wParam` is `FALSE`. `egui`'s
`ViewportBuilder::with_decorations(false)` maps straight onto this, so an egui/eframe
"borderless" window is a fully framed window that is merely hiding its frame.

That stays invisible until something takes the window off DWM's frame path. Setting a
window region with `SetWindowRgn` -- the standard way to give a borderless window a
non-rectangular shape -- does exactly that, and Windows falls back to drawing the
still-present caption the classic way: minimise/maximise/close buttons painted over the
top-right of the client area, on top of your own rendering.

Three things make this expensive to debug:

1. The builder code says `with_decorations(false)`, so the styles are the last suspect.
2. The regression appears in the commit that added the *region*, which looks unrelated
   to decorations, so the bisect points at the wrong change.
3. The window is now genuinely closable by the user (`WS_SYSMENU` + a live close
   button). For a transient overlay -- a recording indicator, a HUD, a toast -- that
   turns a decoration bug into a behavioural one: the thing becomes a window the user
   can leave stranded on screen.

The same trap applies to any other operation that disturbs the frame (layered-window
transitions, `SWP_FRAMECHANGED` from foreign code, some DWM policy changes). The styles
are the bug; the region is only what exposes it.

## WRONG

```rust
// The builder claims no decorations...
let builder = egui::ViewportBuilder::default()
    .with_title("Recording")
    .with_decorations(false)   // winit KEEPS WS_CAPTION|WS_BORDER|WS_SYSMENU
    .with_transparent(true)
    .with_always_on_top();

// ...then a region is applied to get a capsule/rounded shape, which takes the
// window off DWM's frame path and lets Windows draw the caption it never removed.
let region = unsafe { CreateRoundRectRgn(1, 1, w - 1, h - 1, h, h) };
unsafe { SetWindowRgn(hwnd, Some(region), true) };
// -> maximise + close buttons now painted across the top of the "borderless" window,
//    and the user can close it out from under the app that owns it.
```

## RIGHT

```rust
/// Strip the frame styles winit leaves on an "undecorated" window, making it a
/// plain WS_POPUP. Returns whether anything changed -- true exactly once per
/// freshly created window, which doubles as a reliable "this HWND is new" signal.
fn strip_frame_styles(hwnd: HWND) -> bool {
    let framed = (WS_CAPTION.0
        | WS_BORDER.0
        | WS_DLGFRAME.0
        | WS_SYSMENU.0
        | WS_THICKFRAME.0
        | WS_MINIMIZEBOX.0
        | WS_MAXIMIZEBOX.0) as isize;
    let framed_ex = (WS_EX_WINDOWEDGE.0 | WS_EX_CLIENTEDGE.0 | WS_EX_DLGMODALFRAME.0) as isize;

    let style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) };
    let ex_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let want = (style & !framed) | WS_POPUP.0 as isize;
    let want_ex = ex_style & !framed_ex;
    if style == want && ex_style == want_ex {
        return false; // self-verifying: no cache to go stale
    }

    unsafe {
        SetWindowLongPtrW(hwnd, GWL_STYLE, want);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want_ex);
        // A style change is only honoured once the frame is recalculated.
        // SWP_NOACTIVATE is load-bearing for an overlay: it must not take focus.
        let _ = SetWindowPos(
            hwnd, None, 0, 0, 0, 0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE
                | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_NOACTIVATE,
        );
    }
    true
}

// Strip FIRST, then shape. A framed window that then gets a region is the exact
// combination that makes Windows draw the caption by hand.
let restyled = strip_frame_styles(hwnd);
let region = unsafe { CreateRoundRectRgn(1, 1, w - 1, h - 1, h, h) };
unsafe { SetWindowRgn(hwnd, Some(region), true) }; // takes ownership on success
```

## NOTES

- **Order matters.** Strip the styles before `SetWindowRgn`, not after.
- **`SWP_NOACTIVATE` is not optional** for overlays that must never steal focus (e.g. a
  dictation HUD that injects text into the previously focused app). `SWP_FRAMECHANGED`
  without it hands the window activation.
- **Do not cache "already shaped" on the HWND value alone.** Windows recycles HWNDs, so
  a `(hwnd, width, height)` cache key can match a *different*, freshly created window and
  skip the shaping entirely. Make the style check self-verifying (compare current vs.
  target, as above) and use its return value to force the region re-apply -- a fresh
  window always arrives with winit's caption styles, so "styles were wrong" is exactly
  "this is a new window".
- **egui/eframe deferred viewports** hit this per child window; find the child HWND by its
  distinct title (`FindWindowW`) since eframe does not expose the raw handle.
- Verified against winit 0.30.13 / egui + eframe 0.35.0 on Windows 11 (2026-07-26). The
  style list lives in `winit/src/platform_impl/windows/window_state.rs::to_window_styles`;
  the `WM_NCCALCSIZE` override (and its `wParam == 0` bail-out) is in `event_loop.rs`.
  Re-check after any winit major bump -- if winit ever undecorates by style, the strip
  becomes a no-op rather than a conflict, so it is safe to leave in.
- Related: `egui-viewport-position-monitor-size.md` (the other half of making an egui
  child viewport behave like a real OS overlay).
