---
tech: godot
tags: [timers, create-timer, callbacks, queue-free, is-instance-valid, memory]
severity: high
---
# Timer callbacks can outlive their source node

## PROBLEM
`get_tree().create_timer()` creates a timer owned by the SceneTree, not by the node that called it. If the node is freed (`queue_free()`) before the timer fires, the callback lambda tries to access a freed object and crashes with "Invalid call. Receiver is null."

## WRONG
```gdscript
# BAD -- if this node is queue_free()'d before 0.5s, crash on callback
func flash_white():
    get_tree().create_timer(0.5).timeout.connect(
        func(): sprite.modulate = Color.WHITE
    )
```

## RIGHT
```gdscript
# GOOD -- check validity before accessing self or any member
func flash_white():
    get_tree().create_timer(0.5).timeout.connect(
        func():
            if is_instance_valid(self):
                sprite.modulate = Color.WHITE
    )
```

## NOTES
- `is_instance_valid(self)` returns `false` if the node has been freed. This is the correct check for lambda callbacks.
- Alternative: use a node-owned `Timer` node instead of `create_timer()`. Node-owned timers are automatically freed when the node is freed.
- This pattern also applies to signals connected with a lambda -- if the source node is freed, the lambda still fires unless you use the `CONNECT_ONE_SHOT` flag or disconnect manually.
