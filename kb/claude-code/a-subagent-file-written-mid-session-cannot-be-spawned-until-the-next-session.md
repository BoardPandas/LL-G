---
tech: claude-code
tags: [subagents, agents, session-start]
severity: medium
---
# A subagent file written mid-session cannot be spawned until the next session

## PROBLEM
A new `.claude/agents/<name>.md` is not spawnable in the session that wrote it: `Agent(subagent_type: "<name>")` fails with "Agent type not found".
Agent definitions load at session start. Skills written mid-session can be picked up, so it is easy to assume agents are too, and a plan that writes a restricted agent and then delegates to it in the same session stalls.

## WRONG
```text
1. Write .claude/agents/reader.md (read-only tools:)
2. Agent(subagent_type: "reader", prompt: "read the untrusted mail")
   -> Agent type 'reader' not found
```

## RIGHT
```text
Session A: write and commit .claude/agents/reader.md
Session B: Agent(subagent_type: "reader", ...)

Needed now? Use a built-in agent without Write/Edit (e.g. Explore),
and record that it still holds Bash and MCP write tools.
```

## NOTES
The error lists the agent types that are available, so the stand-in can be picked from it. Do not report the restricted agent as having done the work.
