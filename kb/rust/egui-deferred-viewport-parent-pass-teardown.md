---
tech: rust
tags: [egui, eframe, viewport, deferred-viewport, overlay, request_repaint, tray, windows]
severity: high
---
# An egui deferred viewport is torn down only by a PARENT pass, so a self-repainting child outlives its owner

## PROBLEM

`Context::show_viewport_deferred` registers a child viewport for the duration of the
pass that calls it. egui tears down any viewport that was not re-registered -- but the
teardown is driven by the **parent's** `viewport_output`, at the end of the parent's
pass (eframe: `glutin.remove_viewports_not_in(&viewport_output)`). Rendering the *child*
runs only the child's own callback; it never runs the parent's `logic`/`ui`, so it never
re-evaluates whether the child still has a reason to exist.

This collides with the standard animation idiom. Inside a viewport callback,
`ctx.request_repaint()` and `ctx.request_repaint_after()` target
`Context::viewport_id()` -- which during that callback is the *child*. So the usual
"keep animating" line schedules the child, and only the child:

```rust
ctx.request_repaint_after(Duration::from_millis(16)); // schedules THIS viewport
```

The child now keeps itself alive at 60 fps indefinitely while the parent sleeps. Whether
it ever disappears depends entirely on something else waking the parent. Miss that one
wake-up and you are left with an OS window -- typically always-on-top, borderless, and
non-activating, because that is what deferred viewports get used for -- with no owner
left to retire it. It just sits on the user's desktop.

It is worst in a tray/daemon app whose main window is hidden, which is exactly the shape
that wants an overlay in the first place. eframe does run `App::logic` for a hidden root,
but only when the root has a repaint scheduled: on Windows invisible windows never
receive `RedrawRequested`, so eframe paints them directly on a 100 ms throttle and
otherwise, in its own words, "the window will simply sleep."

Why it is expensive to find: the happy path works. A parent that is visible, or an event
stream that reliably wakes the parent, hides the bug completely. It surfaces as a rare,
unreproducible "the overlay got stuck again" report with no error, no log line, and no
failing test -- and the code reads correctly, because the registration *is* properly
gated on state.

## WRONG

```rust
// Parent (runs in App::logic, which also runs while the window is hidden):
fn show_overlay(&mut self, ctx: &egui::Context) {
    if !self.is_recording() {
        return; // stop registering -> egui should tear the window down
    }
    ctx.show_viewport_deferred(id, builder, move |ui, _| paint(ui));
}

// Child callback:
fn paint(ui: &mut egui::Ui) {
    // Keeps the CHILD animating. Says nothing to the parent, so nothing
    // re-runs the `is_recording()` check above. If the parent's wake-up is
    // missed, this window animates forever with no owner.
    ui.ctx().request_repaint_after(Duration::from_millis(16));
    /* ...draw... */
}
```

## RIGHT

```rust
fn paint(ui: &mut egui::Ui) {
    let ctx = ui.ctx();
    // Keep this viewport animating.
    ctx.request_repaint_after(Duration::from_millis(16));

    // AND keep the parent evaluating, because only a parent pass can retire
    // this window. A safety net, not the path: real state changes should still
    // wake the parent immediately, so this can be slow (10 Hz is plenty).
    ctx.request_repaint_after_for(Duration::from_millis(100), egui::ViewportId::ROOT);

    /* ...draw... */
}
```

Invariant to hold onto: **a deferred viewport must never be the only thing keeping
itself scheduled.** Anything that can exist only while a condition holds has to keep the
code that tests that condition running.

## NOTES

- `Context::request_repaint()` resolves to `request_repaint_of(self.viewport_id())`, and
  `viewport_id()` reads the top of `viewport_stack`. Inside a viewport callback that is
  the child; the target is implicit and easy to misread as "the app".
- **From a worker thread the same call is fine.** Outside any pass the viewport stack is
  empty and `unwrap_or_default()` yields `ViewportId::ROOT`, so a
  `ctx.request_repaint()` from a background thread does wake the parent. The trap is
  specifically the call made *inside* the child's own callback.
- Do not treat a status/event channel as sufficient on its own. It makes teardown prompt,
  but it is a single point of failure for the window's entire lifetime -- one dropped
  wake-up is a stranded window, not a late frame.
- The stranded window is often also unclosable-by-design (no decorations, never
  activates), so the user has no way to dismiss it at all. On Windows, check whether
  winit left the caption styles on it -- see
  `winit-undecorated-window-keeps-caption-styles.md`, whose symptom (a close button
  appearing on a borderless overlay) is what makes this one survivable rather than fatal.
- Verified against egui + eframe 0.35.0 (2026-07-26). Relevant source: egui
  `Context::end_pass` / `viewport_stack`; eframe
  `native/glow_integration.rs::run_ui_and_paint` and
  `native/run.rs::check_redraw_requests` (the invisible-window 100 ms throttle).
