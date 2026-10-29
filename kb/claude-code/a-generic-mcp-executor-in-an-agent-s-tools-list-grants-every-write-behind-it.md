---
tech: claude-code
tags: [subagents, tools, mcp, prompt-injection, hooks, read-only]
severity: high
---
# A generic MCP executor in an agent's tools: list grants every write behind it

## PROBLEM
Listing a hub-style executor (one MCP tool that runs any slug, e.g. `MULTI_EXECUTE_TOOL`) in a subagent's `tools:` gives that "read-only" agent every write the hub can do: send mail, create tickets, PATCH APIs.
`tools:` filters by tool name, so it cannot narrow what one generic tool does. The agent looks restricted in its frontmatter, and an injected instruction in the text it reads can still act.

## WRONG
```yaml
tools:
  - Read
  - Grep
  - mcp__hub__MULTI_EXECUTE_TOOL   # "only for mail GETs"
```

## RIGHT
```yaml
tools:
  - Read
  - Grep
  - mcp__hub__MULTI_EXECUTE_TOOL
hooks:
  PreToolUse:
    - matcher: "mcp__.*__MULTI_EXECUTE_TOOL"
      hooks:
        - type: command
          command: node "$CLAUDE_PROJECT_DIR"/.claude/scripts/readonly-guard.mjs
```
The guard parses `tool_input.tools[]` from stdin, allows an explicit list of slug + method + path, fails closed on anything else or an unparseable payload, and exits 2 with the reason on stderr. Test every refusal path.

## NOTES
Agent-frontmatter hooks apply only to that agent, so the main session keeps its normal hub access. Frontmatter hooks need workspace trust for the folder. Also see allowed-tools-does-not-restrict-under-bypass.
