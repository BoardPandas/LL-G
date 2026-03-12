---
tech: godot
tags: [area2d, signals, collision, physics]
severity: medium
---
# Area2D body_entered vs area_entered detect different node types

## PROBLEM
`body_entered` and `area_entered` detect completely different node types. Using the wrong signal causes silent detection failures -- no error, just nothing happens.

## WRONG
```gdscript
# Trying to detect an enemy (CharacterBody2D) with area_entered
func _ready():
    area_entered.connect(_on_hit)  # Never fires for CharacterBody2D!

func _on_hit(area: Area2D):
    area.take_damage(10)
```

## RIGHT
```gdscript
# body_entered for PhysicsBody2D (CharacterBody2D, StaticBody2D, RigidBody2D)
func _ready():
    body_entered.connect(_on_body_hit)

func _on_body_hit(body: Node2D):
    if body.has_method("take_damage"):
        body.take_damage(10)

# area_entered for other Area2D nodes (hitboxes, triggers, pickups)
func _ready():
    area_entered.connect(_on_area_hit)
```

## NOTES
- `body_entered` detects: CharacterBody2D, StaticBody2D, RigidBody2D
- `area_entered` detects: other Area2D nodes
- Both require matching collision layers/masks to fire
- The signal parameter type differs: `Node2D` for body_entered, `Area2D` for area_entered
