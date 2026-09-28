---
tech: rust
tags: [egui, eframe, wgpu, viewport, visibility, tray, windows]
severity: high
---
# A hidden deferred viewport cannot reliably reveal itself from its own callback

## PROBLEM

In eframe 0.36.2's wgpu integration, a deferred viewport without a visible
descendant gets no UI pass when `ViewportInfo::visible()` is `Some(false)`.
That method derives visibility from minimized/occluded state rather than
directly reporting whether the native window was shown. A persistent hidden
window that sends `Visible(true)` only from its own callback depends on a
callback the backend may skip. Hark's prompt appeared for Teams but never for
a subsequent Google Meet call under that design.

## WRONG

```rust
// Schematic: showing the window depends on the hidden child's callback.
ctx.show_viewport_deferred(id, hidden_builder, move |ui, _| {
    if wanted {
        ui.ctx().send_viewport_cmd(egui::ViewportCommand::Visible(true));
    }
});
```

## RIGHT

```rust
// In the root App::logic, after registering the persistent child.
// A worker state change must wake the root.
if appeared {
    ctx.send_viewport_cmd_to(id, egui::ViewportCommand::Visible(true));
    ctx.request_repaint_of(id);
}
// The child paints and can hide itself after a reply.
```

## NOTES

Observed on Windows with eframe/egui 0.36.2 and wgpu; recheck other backends and
versions. Keep registration, show, first-paint, and reply diagnostics distinct:
a detected event is not evidence that a prompt painted. Log labels and state,
never window titles or meeting content.

This complements [parent-pass teardown](egui-deferred-viewport-parent-pass-teardown.md)
and [parent WM_PAINT starvation](egui-child-viewport-starves-parent-wm-paint.md),
which concern hiding/retirement rather than revealing a persistent child.

Evidence: [Hark's root show/repaint and hidden registration](https://github.com/BoardPandas/Hark/blob/9a61d11d06056d6b54b9ad6f4cd8c4fb1f2fe654/crates/hark-app/src/meeting_prompt.rs),
and the second-real-call observations in its meeting plan, section 8.
