---
tech: godot
tags: [scenetree, httprequest, headless, initialize, godot4]
severity: high
---
# In a -s SceneTree script, root is not in the tree during _initialize, so HTTPRequest fails with ERR_UNCONFIGURED

## PROBLEM
Nodes added to `root` inside `_initialize()` of a `godot -s` script are not yet inside the tree, so an HTTPRequest there fails every request with `ERR_UNCONFIGURED`.
The engine logs only `Condition "!is_inside_tree()" is true`, which reads like a bug in your own node code rather than a startup-order issue.

## WRONG
```gdscript
extends SceneTree

func _initialize() -> void:
	var http := HTTPRequest.new()
	root.add_child(http)
	http.request("http://127.0.0.1:3000/health")  # ERR_UNCONFIGURED
```

## RIGHT
```gdscript
extends SceneTree

func _initialize() -> void:
	_run()

func _run() -> void:
	await process_frame
	var http := HTTPRequest.new()
	root.add_child(http)
	http.request("http://127.0.0.1:3000/health")
```

## NOTES
Godot 4.7.2. Any node needing `is_inside_tree()` (timers, HTTPRequest, signals tied to the tree) has the same issue. Make sure every path still reaches `quit()`, or the headless process hangs.
