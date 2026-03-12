---
tech: godot
tags: [autoload, class-name, gdscript, naming-conflicts, singleton]
severity: medium
---
# No class_name on autoload scripts

## PROBLEM
Autoload scripts are accessed by their node name registered in Project Settings (e.g., `GameManager.score`). Adding `class_name GameManager` to an autoload script creates a global type with the same name as the autoload node, causing naming conflicts and unexpected behavior when instantiating or type-checking.

## WRONG
```gdscript
# BAD -- class_name on an autoload
class_name GameManager
extends Node

var score: int = 0
```

## RIGHT
```gdscript
# GOOD -- no class_name, accessed by registered node name
extends Node

var score: int = 0
# Accessed elsewhere as: GameManager.score
```

## NOTES
- Non-autoload scripts that need to be referenced by type (for type hints, `is` checks, or `preload` instantiation) should use `class_name`.
- The conflict occurs because Godot registers both the autoload singleton and the class globally. Having two globals with the same name causes unpredictable resolution.
- If you need type hints for an autoload's properties, see `type-inference.md` for the explicit annotation pattern.
