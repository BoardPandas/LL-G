---
tech: rust
tags: [egui, eframe, winit, windows, viewport, wm-paint, repaint, desktop]
severity: high
---
# A self-animating child viewport starves its parent of WM_PAINT, so the parent stops running passes

## PROBLEM

On Windows a **visible** window is repainted only when the OS delivers
`WM_PAINT` — and `WM_PAINT` is the lowest-priority message there is, generated
only when the thread's message queue is otherwise empty. An eframe deferred
(child) viewport animating at 60 fps keeps that queue busy, with a
vsync-blocking `swap_buffers` inside each of its own frames. The parent's paint
can then go undelivered for **seconds** even though a repaint was requested on
every single pass.

Because `App::logic` runs only inside a parent pass, everything in it stalls
with it: worker events go undrained, the tray and status footer freeze, and a
deferred child viewport is never retired (egui prunes an unregistered viewport
only from the *parent's* `viewport_output`).

Two things make this very hard to attribute:

1. **It inverts the usual symptom.** eframe paints hidden and minimized windows
   *directly* from its own loop (`check_redraw_requests` → `run_ui_and_paint`,
   guarded by `is_invisible_or_minimized`), bypassing the queue entirely. So the
   app behaves perfectly while minimized or in the tray, and only misbehaves
   with its window **open** — the opposite of what "the window is asleep"
   suggests, and it reads as a focus or activation bug.
2. **The obvious kick is a no-op.** `winit::Window::request_redraw()` on Windows
   *is* `RedrawWindow(hwnd, ..., RDW_INTERNALPAINT)`. Calling that yourself to
   "force" the parent re-marks a window that already has a paint pending and
   changes nothing — while looking like a decisive fix in review.

Measure it before theorizing: timestamp a line in the worker and a line in the
UI's event drain, and read the gap. A worker that finished in 665 ms followed by
a UI transition 2.7 s later is this, and no amount of reasoning about egui's
repaint coalescing will show it.

## WRONG

```rust
// In the child viewport's paint callback, at ~60 fps:
ctx.request_repaint_after(Duration::from_millis(16));
// "Keep the parent ticking so it can retire me."
ctx.request_repaint_after_for(Duration::from_millis(100), egui::ViewportId::ROOT);

// ...and when that is not enough, "force" a paint at the OS level:
#[cfg(windows)]
unsafe {
    // No-op: this is verbatim what winit's request_redraw already did.
    // The parent already has an internal paint pending; it is not being
    // DELIVERED, and re-marking it does not change that.
    RedrawWindow(Some(parent_hwnd), None, None, RDW_INTERNALPAINT);
}
// The child stays on screen until something generates real input on the
// parent (mouse move, click) or the user minimizes it, which flips eframe
// onto its direct-paint path.
```

## RIGHT

```rust
// Do not make the child's VISIBILITY depend on a parent pass at all.
// Publish the "should I be up?" fact as shared state the child can read on
// its own pass, instead of only as an event the parent must wake to consume.
pub fn show(ctx: &egui::Context, active: Arc<AtomicBool>, generation: u64) {
    // A fresh id per showing: a child that hid itself must never be handed
    // back to the next one still hidden.
    let id = egui::ViewportId::from_hash_of(("my_overlay", generation));
    ctx.show_viewport_deferred(id, builder, move |ui, _class| {
        let ctx = ui.ctx();
        // Still ask -- only a parent pass can DESTROY the viewport.
        ctx.request_repaint_after_for(Duration::from_millis(100), egui::ViewportId::ROOT);

        if !active.load(Ordering::Relaxed) {
            // Applied by eframe in handle_viewport_output at the end of THIS
            // viewport's own pass. Nothing on screen from here on.
            ctx.send_viewport_cmd(egui::ViewportCommand::Visible(false));
            return;
        }

        ctx.request_repaint_after(Duration::from_millis(16));
        paint(ui);
    });
}
```

Hiding is self-reinforcing: eframe skips the viewport callback for an invisible
viewport (`run_ui = is_visible || is_viewport_or_descendant_visible`), so the
60 fps repaint that caused the starvation stops too, the queue drains, and the
parent wakes promptly to destroy the viewport for real.

## NOTES

- Supersedes the child half of
  [`egui-deferred-viewport-parent-pass-teardown.md`](egui-deferred-viewport-parent-pass-teardown.md):
  `request_repaint_after_for(.., ViewportId::ROOT)` from the child is
  **necessary but not sufficient**. It gets the request made; it cannot get the
  paint delivered.
- egui also coalesces: `ContextImpl::request_repaint_after` forwards to the
  backend only when the new delay is *smaller* than the one already pending for
  that viewport, and clears the pending delay only in that viewport's own
  `begin_pass`. eframe ignores `ViewportOutput::repaint_delay` and listens to
  that callback alone. So a viewport has exactly one outstanding repaint and no
  retry — real, but a red herring here: if the parent is visible and anything in
  its own UI animates (a spinner, a pulsing dot), the request is being made
  every pass anyway.
- The same shape applies to any second always-on-top window an eframe app
  animates: HUDs, level meters, toasts. The parent does not have to be doing
  anything for its paint to be starved.
- Verified against egui/eframe 0.35.0 + winit 0.30.13 on Windows, 2026-07-29.
- Symptom checklist: works minimized, breaks with the window open; the child
  animates smoothly while the parent's UI is frozen; any mouse input over the
  parent instantly unsticks it.
