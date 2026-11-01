---
tech: godot
tags: [control, anchors, ui, layout, godot4]
severity: high
---
# Control.set_anchors_preset keeps the current position; use set_anchors_and_offsets_preset to fill the parent

## PROBLEM
`set_anchors_preset(PRESET_FULL_RECT)` on a code-built Control recomputes offsets to keep its current rect, so the control stays at its minimum size in the top-left corner.
No error is printed and every logic test passes; it shows only on screen.

## WRONG
```gdscript
var screen := CenterContainer.new()
screen.set_anchors_preset(Control.PRESET_FULL_RECT)
add_child(screen)  # stuck top-left at minimum size
```

## RIGHT
```gdscript
var screen := CenterContainer.new()
screen.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
add_child(screen)
```

## NOTES
Godot 4.7.2. For corner labels, also set `grow_horizontal`/`grow_vertical` to `GROW_DIRECTION_BEGIN` so text grows inward. Take a screenshot in headless checks; this layout bug was only caught by looking.
