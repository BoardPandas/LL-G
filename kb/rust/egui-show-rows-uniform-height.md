---
tech: rust
tags: [egui, scrollarea, show-rows, virtualization, ui, layout]
severity: medium
---
# ScrollArea::show_rows assumes uniform row heights; heterogeneous lists break the scroll math

## PROBLEM
`egui::ScrollArea::show_rows(ui, row_height, total_rows, ..)` virtualizes by pure arithmetic: it converts the scroll offset into a visible index range and pads the space before and after with `row_height * count`. Every row must therefore be exactly `row_height` tall. The moment a list interleaves anything of a different height -- day/group headers, an expandable detail row, a "load more" sentinel -- the arithmetic and the actual layout disagree: rows shift under the cursor, the scrollbar length is wrong, and scrolling jumps. Nothing errors or warns, and the list looks fine until the first non-uniform element renders, so the bug typically surfaces late (e.g. the first time a user expands a row).

## WRONG
```rust
// History list with day headers and click-to-expand rows.
egui::ScrollArea::vertical().show_rows(ui, ROW_HEIGHT, entries.len(), |ui, range| {
    for i in range {
        if is_first_of_day(i) {
            ui.label(day_header(i)); // extra height: scroll math now wrong
        }
        row(ui, &entries[i]);
        if expanded == Some(i) {
            details(ui, &entries[i]); // variable height: worse
        }
    }
});
```

## RIGHT
```rust
// Heterogeneous list: bound the work with windowed queries + a sentinel
// instead of per-row virtualization. Cache the window; re-fetch only when
// (data generation, filter, windows loaded) changes, so idle frames are free.
egui::ScrollArea::vertical().show(ui, |ui| {
    for entry in &cached_window {          // e.g. pages * 100 rows, capped
        maybe_day_header(ui, entry);
        row(ui, entry);                    // any height is fine now
    }
    if cached_window.len() < matching_total {
        if ui.button("Show more").clicked() {
            pages += 1;                    // widens the window next frame
        }
    }
});
```

## NOTES
- `show_rows` remains the right tool for genuinely uniform lists (log lines, fixed-height tables).
- For large heterogeneous lists, the alternatives are `show_viewport` with hand-rolled per-item height bookkeeping (complex) or bounding the rendered set as above; if a hard cap already exists upstream (retention limit, page size), the bounded plain `ScrollArea` is dramatically simpler and fast enough.
- Found at Hark Phase 4 CP4 (2026-07-16): the planned `show_rows` history list was replaced by windowed LIMIT/OFFSET queries behind a "Show more" button once day headers and expandable rows entered the design.
