---
tech: supportforge
tags: [supportforge, remote-session, execute_command, connect_agent]
severity: medium
---
# "Session is held by API instance ..., which did not respond" clears with disconnect and reconnect

## PROBLEM
After a session sits idle or the API process holding it restarts, execute_command can fail with `Session is held by API instance <id>, which did not respond. Reconnect to the agent and retry.` Retrying the same call keeps failing. In the same state, list_directory can return `The record was not found.` for a path that exists.

## WRONG
```text
execute_command(agentId, ...)   -> Session is held by API instance 84f6ed7dc4be#3, which did not respond
execute_command(agentId, ...)   -> same error again
```

## RIGHT
```text
disconnect_agent(agentId)       -> "Session ... was already ended. Cleaned up MCP mapping."
connect_agent(agentId)          -> new session id
execute_command(agentId, ...)   -> runs
```

## NOTES
Keep one agent connection open at a time (see execute-command-cross-session-output), and pass agentId explicitly.
