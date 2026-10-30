---
tech: godot
tags: [jolt, physics, project-settings, godot-4.7, headless]
severity: high
---
# A project.godot not made by the New Project dialog runs Godot Physics, not Jolt, because DEFAULT still means GodotPhysics3D

## PROBLEM
In Godot 4.6+ (verified 4.7.2), `physics/3d/physics_engine` defaults to `DEFAULT`, and `DEFAULT` runs Godot Physics, not Jolt. A `project.godot` written by hand, by a script, or from a template therefore never gets Jolt.
It is not obvious because the release notes say Jolt is "the default for new projects". That default comes from the editor's New Project dialog writing `"Jolt Physics"` explicitly, not from the setting's default value. Nothing warns, the project runs, and physics behavior quietly differs from what the team designed for. `PhysicsServer3D.get_class()` returns `PhysicsServer3D` under both engines, so it cannot tell you which is running.

## WRONG
```ini
; project.godot generated outside the editor: no physics section
config_version=5

[application]
config/name="My Game"
```

## RIGHT
```ini
config_version=5

[application]
config/name="My Game"

[physics]
3d/physics_engine="Jolt Physics"
```

```gdscript
# Verify by behaviour: only Jolt warns about the unsupported hinge bias parameter.
var space := PhysicsServer3D.space_create()
var a := PhysicsServer3D.body_create()
var b := PhysicsServer3D.body_create()
PhysicsServer3D.body_set_space(a, space)
PhysicsServer3D.body_set_space(b, space)
var j := PhysicsServer3D.joint_create()
PhysicsServer3D.joint_make_hinge(j, a, Transform3D.IDENTITY, b, Transform3D.IDENTITY)
PhysicsServer3D.hinge_joint_set_param(j, PhysicsServer3D.HINGE_JOINT_BIAS, 0.9)
# Jolt prints: "Hinge joint bias is not supported when using Jolt Physics."
# DEFAULT and "GodotPhysics3D" print nothing.
```

## NOTES
- The valid values (from the setting's hint) are `DEFAULT`, `Jolt Physics`, `GodotPhysics3D` and `Dummy`.
- Existing projects upgraded from before 4.6 also stay on Godot Physics for the same reason.
- To set it from a script rather than by hand, run `ProjectSettings.set_setting("physics/3d/physics_engine", "Jolt Physics")` then `ProjectSettings.save()` from a headless `-s` script.
