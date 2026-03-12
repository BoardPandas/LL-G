---
tech: godot
tags: [preload, resource-paths, res-path, crash, parse-time]
severity: high
---
# Preload paths must match exact file locations

## PROBLEM
`preload("res://path/to/scene.tscn")` is resolved at parse time (when the script is loaded), not at runtime. If the referenced file doesn't exist, the script crashes immediately when any node using it is added to the scene -- even if the `preload` line is never executed.

## WRONG
```gdscript
# BAD -- scene doesn't exist yet or path is wrong
const BULLET = preload("res://scenes/player/projectile.tscn")
# Crash: "res://scenes/player/projectile.tscn" does not exist
```

## RIGHT
```gdscript
# GOOD -- file exists at exactly this path
const BULLET = preload("res://scenes/projectiles/bullet.tscn")
```

## NOTES
- `preload` paths are case-sensitive on Linux/Mac. Even if it works on Windows, it may fail on a Linux export target.
- If a scene isn't ready yet, use `load()` instead of `preload()` -- `load()` is resolved at runtime and won't crash the parser.
- The Godot editor will warn about missing preload paths when you open the script. Always fix these warnings before committing.
