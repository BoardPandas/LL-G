---
tech: claude-code
tags: [hooks, posttooluse, subagents, additionalcontext, session-id]
severity: high
---
# A subagent's tool call fires the parent session's PostToolUse hook

## PROBLEM
In Claude Code, a subagent's tool call fires the PostToolUse hooks of the session that spawned it, with the parent's `session_id`. A hook that delivers something to "this session" at its next tool call, such as an urgent message as `additionalContext`, can hand it to a subagent instead: the text lands in the subagent's context, the main agent never sees it, and any server-side "already shown to this session" record is now wrong. Nothing errors, and a throttle per `session_id` makes it worse, because the subagent's call can use up the window the main agent would have had.

## WRONG
```bash
# PostToolUse hook: "show urgent mail once, at this session's next tool call"
sid=$(jq -r .session_id)            # the parent's id, even inside a subagent
digest=$(curl ... "{\"client_session_id\":\"$sid\",\"event\":\"tool\"}")
jq -n --arg t "$digest" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$t}}'
```

## RIGHT
```bash
# Re-show anything important at the next UserPromptSubmit until it is read: a prompt is
# always the main agent's. Treat a tool-call delivery as best effort, and if your Claude Code
# version's payload names the subagent (check for agent_id / agent_type), skip or tag it.
```

## NOTES
- Seen with Roundtable's `rt` hooks (2026-10-17): the server recorded an urgent message as shown to the main session at 15:58:37, while the only context it reached was a background subagent's; the main agent saw it at the next prompt, because urgent mail is re-shown at every prompt until read.
- A headless `claude -p` session refuses a foreground `sleep`, so a busy-session test that sleeps runs each step in the background and each completion arrives as a prompt; use `python3 -c 'import time; time.sleep(n)'` to stay in the foreground and exercise PostToolUse.
