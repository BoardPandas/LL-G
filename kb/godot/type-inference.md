---
tech: godot
tags: [gdscript, type-inference, walrus-operator, base-class, script-properties]
severity: medium
---
# := type inference fails through base-class-typed variables

## PROBLEM
When a variable is declared with a base class type (e.g., `CharacterBody2D`) but the actual instance has additional script-defined properties, the `:=` operator can't infer the type of those properties. The GDScript parser only sees the declared base type, not the runtime script.

## WRONG
```gdscript
# BAD -- player is typed as CharacterBody2D, but current_light_radius is defined in Player.gd
@onready var player: CharacterBody2D = $Player
var min_distance := player.current_light_radius + 50.0
# Parse Error: Cannot infer type of "min_distance" -- variable is typed as "Variant"
```

## RIGHT
```gdscript
# GOOD -- explicit type annotation bypasses inference
@onready var player: CharacterBody2D = $Player
var min_distance: float = player.current_light_radius + 50.0

# Or type the variable as the script class directly:
@onready var player: Player = $Player  # requires Player.gd to have class_name Player
var min_distance := player.current_light_radius + 50.0  # now works
```

## NOTES
- This is a GDScript parser limitation, not a runtime issue. The property exists at runtime; the parser just can't prove its type at compile time.
- Using explicit type annotations everywhere is the safer pattern -- `:=` is convenient but breaks down at class boundaries.
- If the script is an autoload, do NOT add `class_name` to fix this (see `no-class-name-autoload.md`). Use explicit annotations instead.
