---
tech: godot
tags: [tscn, sub-resource, resource-id, scene-format, hand-writing]
severity: high
---
# Sub-resource IDs in .tscn must be unique strings

## PROBLEM
When hand-writing or editing `.tscn` files directly, every `[sub_resource]` and `[ext_resource]` declaration needs a unique `id` string. Duplicate IDs cause silent resource conflicts -- the wrong resource is used, or properties bleed between nodes.

## WRONG
```
[sub_resource type="RectangleShape2D" id="RectangleShape2D_1"]
extent = Vector2(16, 16)

[sub_resource type="RectangleShape2D" id="RectangleShape2D_1"]  # duplicate!
extent = Vector2(32, 32)
```

## RIGHT
```
[sub_resource type="RectangleShape2D" id="RectangleShape2D_abc12"]
extent = Vector2(16, 16)

[sub_resource type="RectangleShape2D" id="RectangleShape2D_xyz89"]
extent = Vector2(32, 32)
```

## NOTES
- Godot generates IDs with format `"TypeName_5charsuffix"` (e.g., `"RectangleShape2D_abc12"`). Follow this convention when creating IDs manually.
- The suffix only needs to be unique within the file. A 5-character alphanumeric string is sufficient.
- Prefer creating resources through the Godot editor when possible -- it handles ID generation automatically.
