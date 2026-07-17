---
tech: rust
tags: [egui, CollapsingHeader, open, controlled-state, progressive-disclosure]
severity: medium
---
# CollapsingHeader::open(Some(..)) every frame locks the header; pass it for one frame to latch

## PROBLEM
`CollapsingHeader::open` takes an `Option<bool>`. Passing `Some(state)` on
every frame makes the header fully controlled: the user's clicks appear to
do nothing because the next frame forces the stored state right back. The
non-obvious part is the correct idiom for "programmatically expand this
section now, but leave the user in charge afterwards" (e.g. auto-expanding
an endpoint section when a provider that requires it is selected): pass
`Some(true)` for exactly one frame, then `None` forever after. The one
forced frame writes the openness into egui memory, and `None` frames read
it back, so the header stays open yet remains user-collapsible.

## WRONG
```rust
// Forces the state every frame: the user can never collapse it while the
// condition holds, and clicks look broken.
CollapsingHeader::new("Model & endpoint")
    .open(Some(kind == ProviderKind::OpenaiCompatible))
    .show(ui, |ui| { /* ... */ });
```

## RIGHT
```rust
// A one-shot flag set at the event (the kind switch), consumed at render.
if kind_changed && kind == ProviderKind::OpenaiCompatible {
    self.force_endpoint_open = true;
}

let force_open = self.force_endpoint_open.then_some(true);
self.force_endpoint_open = false; // one frame only
CollapsingHeader::new("Model & endpoint")
    .default_open(kind == ProviderKind::OpenaiCompatible)
    .open(force_open) // Some(true) once latches; None afterwards frees it
    .show(ui, |ui| { /* ... */ });
```

## NOTES
- `default_open` only applies the first time the header is ever rendered
  (before any stored state exists); it cannot re-open a header mid-session,
  which is why the one-shot `open(Some(true))` is needed at all.
- Same pattern applies to `CollapsingState` and other egui widgets with an
  `Option`-controlled open/selected parameter.
- Verified on egui 0.35 (2026-07-16).
