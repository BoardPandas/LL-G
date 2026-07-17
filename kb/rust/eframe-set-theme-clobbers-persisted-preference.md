---
tech: rust
tags: [egui, eframe, theme, persistence, ThemePreference, set_theme, egui-memory]
severity: high
---
# Startup set_theme(System) silently clobbers the user's persisted theme preference

## PROBLEM
eframe (with the `persistence` feature) restores egui memory, including the
user's `ThemePreference` (System/Light/Dark, set via `ctx.set_theme` from a
settings UI), before the app constructor runs. A theme-setup function that
ends with `ctx.set_theme(ThemePreference::System)` "to follow the OS by
default" therefore resets the user's persisted choice on every launch. The
app still renders correctly in some theme, so nothing errors; the user's
Light/Dark selection just quietly stops sticking across restarts, and the
bug reads like "persistence is broken" rather than "startup overwrote it".

## WRONG
```rust
pub fn apply(ctx: &egui::Context) {
    ctx.set_fonts(font_definitions());
    ctx.set_visuals_of(Theme::Dark, dark_visuals());
    ctx.set_visuals_of(Theme::Light, light_visuals());
    // Runs at every startup: overwrites whatever preference egui memory
    // just restored from the previous session.
    ctx.set_theme(ThemePreference::System);
}
```

## RIGHT
```rust
pub fn apply(ctx: &egui::Context) {
    ctx.set_fonts(font_definitions());
    ctx.set_visuals_of(Theme::Dark, dark_visuals());
    ctx.set_visuals_of(Theme::Light, light_visuals());
    // Re-apply whatever is current: System on a fresh install (egui's
    // default), the restored user choice on every later launch.
    let preference = ctx.options(|o| o.theme_preference);
    ctx.set_theme(preference);
}
```

## NOTES
- Testable without a window: `egui::Context::default()`, `set_theme(Dark)`,
  call your apply(), assert `ctx.options(|o| o.theme_preference)` is still
  Dark.
- Only bites when a settings UI writes the preference AND startup code sets
  an explicit default; either alone is fine, which is why it survives
  review.
- Verified on egui/eframe 0.35 (2026-07-16).
