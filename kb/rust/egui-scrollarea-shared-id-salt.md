---
tech: rust
tags: [egui, eframe, scrollarea, id_salt, ui-state, scroll-offset, gui]
severity: medium
---
# Sibling ScrollAreas built on the same parent Ui silently share one scroll offset

## PROBLEM

A `ScrollArea`'s persisted state (its scroll offset) is keyed by an `Id` derived
from **the parent `Ui`'s id plus a salt**, and that salt defaults to the literal
string `"scroll_area"` for every scroll area in the program. From egui 0.35
`containers/scroll_area.rs`:

```rust
let id_salt = id_salt.unwrap_or_else(|| IdSalt::new("scroll_area"));
let id = ui.make_persistent_id(id_salt);   // = ui.id.with(id_salt)
```

Note what it is *not* derived from: the widget auto-id counter. Two scroll areas
created at different points in the same `Ui`, in different branches, in different
functions, or in different modules all collapse to the **same `Id`** as long as
they share a parent `Ui` — which is exactly what happens with the common
"one centered content column, `match` on the current page" shell:

```rust
ui.vertical(|ui| {            // <-- one parent Ui, identical id every frame
    match page {
        Page::History  => history.show(ui, ..),    // ScrollArea inside
        Page::Settings => settings.show(ui, ..),   // ScrollArea inside
        ...
    }
});
```

Every page then reads and writes one shared offset, so switching tabs lands the
new page scrolled wherever the previous page was left. Two things keep it quiet:

- `check_for_id_clash` never fires, because only one branch of the `match`
  renders per frame — the ids collide across *time*, not within a frame.
- The offset is clamped to content height, so a short page just snaps to its
  bottom rather than showing blank space. It reads as a layout bug, and the
  page's own code — where you will look — is entirely innocent.

Worst on any flow that navigates *between* two of those pages programmatically
(a "add this to X" handoff that jumps from a long scrolled list to another page),
because that path hits the bug on every single use.

## WRONG

```rust
// pages.rs -- all of these are built on the same parent Ui
match page {
    Page::History => {
        egui::ScrollArea::vertical()          // id = parent.with("scroll_area")
            .auto_shrink([false, false])
            .show(ui, |ui| { .. });
    }
    Page::Settings => {
        egui::ScrollArea::vertical()          // SAME id -> same stored offset
            .auto_shrink([false, false])
            .show(ui, |ui| { .. });
    }
}
```

## RIGHT

```rust
match page {
    Page::History => {
        egui::ScrollArea::vertical()
            .id_salt("history-list")          // distinct id -> its own offset
            .auto_shrink([false, false])
            .show(ui, |ui| { .. });
    }
    Page::Settings => {
        egui::ScrollArea::vertical()
            .id_salt("settings-form")
            .auto_shrink([false, false])
            .show(ui, |ui| { .. });
    }
}
```

Give **every** `ScrollArea` an explicit `id_salt` as a matter of course, the way
you would name a persistent widget. It costs one line and removes a whole class
of "why did this page open scrolled?" investigation.

## NOTES

- Verified against egui 0.35.0 (`containers/scroll_area.rs::begin`, and
  `Ui::make_persistent_id`, which is `self.id.with(id_salt)`).
- The same parent-Ui-plus-salt derivation applies to other persistent-state
  containers (`CollapsingHeader`, `Window`, `Grid`, `Modal`); anywhere you build
  two of them on one parent `Ui`, salt them. Iterated containers need
  `.id_salt(index)`.
- `id_salt` was named `id_source` before egui 0.28; older examples use the old
  name.
- Wrapping each branch in its own `ui.push_id(page, ..)` also separates them, by
  changing the *parent* id instead of the salt — fine, but it moves the fix away
  from the container it protects.
- Changing a salt discards any previously persisted offset for that area (it
  starts at 0 once). Harmless, but it means you cannot rename salts to "fix" a
  scroll position complaint and expect the old state back.
- Related: `egui-show-rows-uniform-height.md` (the other silent scrollbar
  desync — heterogeneous rows under `show_rows`).
