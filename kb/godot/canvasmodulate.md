---
tech: godot
tags: [light2d, pointlight2d, canvasmodulate, rendering, darkness, near-black]
severity: high
---
# CanvasModulate must be near-black, not pure black; required for PointLight2D

## PROBLEM
Two separate issues:
1. `PointLight2D` has no visible effect without a `CanvasModulate` node in the same viewport. The light renders but produces no illumination difference.
2. Setting `CanvasModulate` to pure black `Color(0, 0, 0)` makes `PointLight2D` completely invisible too. The modulate color must allow at least some light to show through.

## WRONG
```gdscript
# BAD -- no CanvasModulate: PointLight2D does nothing visible

# BAD -- pure black kills lights entirely
color = Color(0, 0, 0, 1)
```

## RIGHT
```gdscript
# GOOD -- near-black lets lights punch through
# Set CanvasModulate color property in inspector or:
color = Color(0.02, 0.02, 0.04, 1)  # very dark blue-black

# Scene structure:
# World (Node2D)
#   CanvasModulate  <-- this node must exist
#   TileMap
#   Player
#     PointLight2D  <-- now visible
#   Enemies
```

## NOTES
- The `CanvasModulate` node multiplies all canvas colors by its color. Black (0,0,0) = multiply by zero = everything is black, including lights.
- `(0.02, 0.02, 0.04)` is a good starting value: dark enough to create atmosphere, light enough for `PointLight2D` to be clearly visible.
- Only one `CanvasModulate` per viewport is needed. Multiple ones will compound the effect.
- `PointLight2D` texture can be a `GradientTexture2D` defined as a sub-resource in the .tscn -- no external PNG file needed.
