---
tech: godot
tags: [onready, node-paths, scene-tree, variable-naming]
severity: high
---
# @onready var paths must match .tscn node names exactly

## PROBLEM
`@onready var light: PointLight2D = $PointLight2D` uses the node name from the scene tree. If the node is named differently in the `.tscn` file (e.g., `PointLight2D2` or `PlayerLight`), the assignment fails silently at runtime -- the variable is `null` and any subsequent access crashes.

## WRONG
```gdscript
# BAD -- node is named "PlayerLight" in .tscn but script looks for "PointLight2D"
@onready var light: PointLight2D = $PointLight2D  # null at runtime
```

## RIGHT
```gdscript
# GOOD -- name matches exactly what's in the .tscn
@onready var light: PointLight2D = $PlayerLight

# Or use a path for nested nodes:
@onready var health_bar: ProgressBar = $UI/HealthBar
```

## NOTES
- Node names in `.tscn` files are the `[node name="NodeName" ...]` field, not the type.
- When renaming nodes in the Godot editor, it automatically updates `@onready` references in attached scripts. If renaming manually in the .tscn file, update the script too.
- Null checks at startup can catch this early:
  ```gdscript
  func _ready():
      assert(light != null, "light node not found -- check node name in scene")
  ```
