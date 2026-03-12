---
tech: godot
tags: [input, project-godot, input-map, serialization]
severity: medium
---
# project.godot input map serialization is fragile when hand-written

## PROBLEM
Godot's InputEventKey variant encoding in project.godot is verbose and error-prone when written by hand or by an AI. If input map entries don't serialize correctly, actions silently fail to register.

## WRONG
```ini
# Hand-written input map with incorrect variant encoding
[input]
move_up={
"deadzone": 0.5,
"events": [Object(InputEventKey, "keycode": 87)]
}
# Silently broken -- action never triggers
```

## RIGHT
```gdscript
# Option 1: Use Godot editor to create input map entries (preferred)
# Project -> Project Settings -> Input Map

# Option 2: Fall back to direct key checks if input map is unreliable
var moving_up := Input.is_key_pressed(KEY_W)

# Option 3: Use Input.is_action_pressed when input map works
var moving_up := Input.is_action_pressed("move_up")
```

## NOTES
- Always prefer configuring input maps through the Godot editor, not by hand-editing project.godot
- If an input action doesn't respond, check the project.godot serialization first
- Direct key checks (`Input.is_key_pressed`) are a reliable fallback for development
- The correct variant format includes resource_type, resource_name, and full property encoding
