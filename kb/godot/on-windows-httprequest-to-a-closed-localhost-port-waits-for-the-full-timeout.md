---
tech: godot
tags: [httprequest, windows, timeout, networking, godot4]
severity: medium
---
# On Windows, HTTPRequest to a closed localhost port waits for the full timeout instead of failing fast

## PROBLEM
In Godot 4.7 on Windows, an HTTPRequest to a closed localhost port does not get connection-refused quickly; it waits until its `timeout` expires.
A check that makes many calls against a down server multiplies the delay and can trip a watchdog, looking like a hang.

## WRONG
```gdscript
for step in steps:
	var r := await client.call_api(step)  # each waits 10 s when the server is down
```

## RIGHT
```gdscript
var first := await client.sign_up(user)
if first.kind == AuthResult.Kind.UNREACHABLE:
	_finish()  # stop at the first unreachable answer
	return
```

## NOTES
Godot 4.7.2 on Windows 11. Keep `timeout` short (around 10 s) and treat status 0 as unreachable.
