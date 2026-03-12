---
tech: godot
tags: [scene-tree, node-hierarchy, projectiles, transform, add-child]
severity: high
---
# Projectiles must be children of a container node

## PROBLEM
If a projectile is added as a child of the player node (`add_child(bullet)`), it inherits the player's transform (position and rotation). The bullet rotates and moves with the player instead of traveling independently in a straight line.

## WRONG
```gdscript
# BAD -- bullet becomes child of player, inherits player's movement
func _shoot():
    var bullet = BULLET.instantiate()
    add_child(bullet)  # 'self' is the player -- bullet moves with player
    bullet.velocity = Vector2.RIGHT.rotated(rotation) * BULLET_SPEED
```

## RIGHT
```gdscript
# GOOD -- bullet goes in a sibling container node
func _shoot():
    var bullet = BULLET.instantiate()
    get_tree().current_scene.get_node("Projectiles").add_child(bullet)
    bullet.global_position = global_position  # set world position explicitly
    bullet.velocity = Vector2.RIGHT.rotated(rotation) * BULLET_SPEED
```

## NOTES
- The container node (`Projectiles`) should be a plain `Node2D` at the root of the scene, sibling to the player.
- Always set `global_position` on the projectile after adding it to the container, since it no longer inherits the player's local position.
- Same rule applies to any spawned object that should be independent: explosions, pickups, visual effects.
