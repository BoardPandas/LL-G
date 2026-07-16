---
tech: rust
tags: [egui, eframe, gui, breaking-change, app-trait, panels, migration]
severity: medium
---
# eframe 0.34 replaced App::update with logic + ui; 0.35 deleted the old names and unified the panels

## PROBLEM
eframe 0.34 split the single `App::update(&mut self, ctx, frame)` callback into `logic(&mut self, ctx, frame)` (defaulted; no painting allowed) and `ui(&mut self, ui: &mut egui::Ui, frame)` (required), and 0.35 removed all deprecated items. In the same window, egui unified `SidePanel`/`TopBottomPanel` into one `egui::Panel` type (`Panel::left("id")`, `::bottom("id")`, `.exact_size(px)`) and renamed `show_inside` to `show`. Every pre-0.34 example, template, and LLM-memorized snippet fails to compile, and the new `ui()` parameter is a root `Ui` with no margin or background (wrap content in `CentralPanel::default().show(ui, ..)`), which no old example demonstrates.

## WRONG
```rust
// Pre-0.34 shape: does not compile on eframe 0.35.
impl eframe::App for MyApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        egui::SidePanel::left("nav").show(ctx, |ui| { /* ... */ });
        egui::CentralPanel::default().show(ctx, |ui| { /* ... */ });
    }
}
```

## RIGHT
```rust
impl eframe::App for MyApp {
    // Non-UI work; also runs while the window is hidden whenever
    // request_repaint() fires -- the correct slot for draining worker
    // events or tray messages.
    fn logic(&mut self, _ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.drain_events();
    }
    // Root Ui: no margin, no background. Panels take the parent Ui now.
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        egui::Panel::left("nav").exact_size(184.0).show(ui, |ui| { /* ... */ });
        egui::CentralPanel::default().show(ui, |ui| { /* ... */ });
    }
}
```

## NOTES
Verify the trait from the registry source (`~/.cargo/registry/src/*/eframe-<ver>/src/epi.rs`) before writing the impl; the split has moved twice and memorized shapes are stale. Cross-thread UI wake-up is unchanged: clone the `Context`, call `request_repaint()` from the sending thread.
