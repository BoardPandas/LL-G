---
tech: rust
tags: [egui, ecosystem, dependencies, version-skew, icon-font, vendoring]
severity: medium
---
# egui companion crates habitually lag core minor releases

## PROBLEM
egui ships minor releases faster than its ecosystem follows, and egui minors are semver-breaking. Verified 2026-07-16 with egui at 0.35: egui-phosphor 0.12.0 pins egui ^0.34, egui-notify 0.34, catppuccin-egui 0.33, egui-modal 0.30. Adding any of them next to current egui either fails resolution or drags a second egui version into the graph (two `Context` types that do not interoperate). The lag is chronic, not a one-off: plan for it whenever egui is current.

## WRONG
```toml
[dependencies]
egui = "0.35"
eframe = "0.35"
egui-phosphor = "0.12"   # pins egui ^0.34: resolution conflict or duplicate egui
egui-modal = "0.6"       # pinned to egui 0.30-era; same problem
```

## RIGHT
```toml
# Prefer built-ins over companions: egui::Modal (core since 0.30),
# Context::animate_value_with_time for micro-motion, hand-rolled Visuals
# instead of theme crates.
[dependencies]
egui = "0.35"
eframe = "0.35"
```
```rust
// For thin asset crates (icon fonts), vendor the asset + its generated
// constants FROM THE SAME crate package so glyphs and codepoints cannot
// drift; swapping back when the crate catches up is a drop-in.
//   curl -sSLO https://static.crates.io/crates/egui-phosphor/egui-phosphor-0.12.0.crate
//   tar -xzf ... -> res/Phosphor.ttf + src/variants/regular.rs constants
pub mod icons {
    pub const MICROPHONE: &str = "\u{E326}"; // from the matching regular.rs
}
```

## NOTES
Check compatibility before committing to a companion crate: `https://crates.io/api/v1/crates/<name>/<ver>/dependencies` shows the egui requirement. A `[patch.crates-io]` fork also works but adds a repo to maintain; vendoring beats it for single-asset crates.
