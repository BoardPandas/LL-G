---
tech: godot
tags: [mouse-filter, gui, picking, input, subviewport, testing]
severity: high
---
# A full-window host Control with the default MOUSE_FILTER_STOP makes gui_get_hovered_control() never null, so world picking silently dies

## PROBLEM
A full-window host Control (a screen switcher, an app root) keeps the default `MOUSE_FILTER_STOP`, so `Viewport.gui_get_hovered_control()` returns it everywhere and any "is the mouse over the UI?" check built on it is always true.
World clicks (cast toward the cursor, click-to-move) then do nothing, with no error. Keyboard input still works, so the game looks mostly fine. Tests that feed scripted input to the gameplay layer never go through mouse picking, so every automated check passes.

## WRONG
```gdscript
# Root of the client: hosts screens, never takes clicks itself.
func _ready() -> void:
	set_anchors_and_offsets_preset(PRESET_FULL_RECT)  # mouse_filter stays STOP

# In the game screen:
func _ground_under_mouse() -> Variant:
	if get_viewport().gui_get_hovered_control() != null:
		return null  # always taken: the host is hovered everywhere
	...
```

## RIGHT
```gdscript
func _ready() -> void:
	set_anchors_and_offsets_preset(PRESET_FULL_RECT)
	mouse_filter = MOUSE_FILTER_IGNORE  # hosts and layout wrappers ignore the mouse

# Test picking with real events in a window-sized SubViewport
# (headless, the root viewport is 64 x 64):
var screen := SubViewport.new()
screen.size = Vector2i(1280, 720)
add_child_autofree(screen)
screen.add_child(app)
var motion := InputEventMouseMotion.new()
motion.position = Vector2(screen.size) * 0.25
screen.push_input(motion)
Input.action_press(&"cast")
# sample input, then assert cast fired and aims at the ground under the mouse
```

## NOTES
Containers default to PASS and Labels to IGNORE, but a plain `Control` defaults to STOP. Also assert the negative case (mouse over a real button blocks the action) so the fix does not just delete the HUD check. Aim at an off-centre point: a failed pick often falls back to (0, 0), which matches a centre-of-screen assertion by accident. Related: `godot/control-set-anchors-preset-keeps-the-current-position-use-set-anchors-and`.
