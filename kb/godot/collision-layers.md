---
tech: godot
tags: [collision, physics, collision-layer, collision-mask, area2d, body-entered]
severity: high
---
# collision_layer vs collision_mask

## PROBLEM
`collision_layer` and `collision_mask` have different meanings. `collision_layer` defines what layer this object is on ("what I am"). `collision_mask` defines which layers this object scans for ("what I detect"). A common mistake is setting both to the same layer, causing objects to detect objects of the same type when they shouldn't.

## WRONG
```gdscript
# BAD -- projectile is on layer 3 AND scans layer 3 (detects other projectiles)
collision_layer = 4   # bit 3 = projectile layer
collision_mask = 4    # also scanning for projectiles
```

## RIGHT
```gdscript
# GOOD -- projectile IS a projectile, SCANS FOR enemies and walls
collision_layer = 4   # bit 3: "I am a projectile"
collision_mask = 10   # bits 2+4: enemies (bit 2 = 2) + walls (bit 4 = 8) = 10

# Player example:
# collision_layer = 1   # bit 1: "I am a player"
# collision_mask = 14   # bits 2+3+4: enemies(2) + projectiles(4) + walls(8) = 14
```

## NOTES
- Layer values are powers of 2 (layer 1 = 1, layer 2 = 2, layer 3 = 4, layer 4 = 8, etc.)
- `Area2D` uses `body_entered` to detect `PhysicsBody2D` nodes (CharacterBody2D, RigidBody2D, StaticBody2D). Use `area_entered` to detect other `Area2D` nodes. Using the wrong signal silently detects nothing.
- In the Godot inspector, layers are shown as a grid of checkboxes. Layer 1 = leftmost checkbox.
