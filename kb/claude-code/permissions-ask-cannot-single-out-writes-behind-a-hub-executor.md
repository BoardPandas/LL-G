---
tech: claude-code
tags: [permissions, ask, hooks, pretooluse, mcp, hub, executor, bypasspermissions, connector]
severity: high
---
# permissions.ask cannot single out writes behind a hub executor, so a vendor move silently drops the prompt

## PROBLEM
Permission rules match tool names, never tool arguments. When a vendor's MCP tools were direct (`mcp__<server-id>__RiskCreate`), a name rule like `mcp__<server-id>__*Create*` in `permissions.ask` made every write prompt. Once the same vendor is reached through a hub's generic executor (`mcp__hub__MULTI_EXECUTE_TOOL` with `{"tool_slug": "vendor__RiskCreate"}`), the write is just one call to a tool whose name says nothing about what it runs.

Two things then fail silently together:
- The old rules are keyed to the direct server's connection id. When that connection is removed or reconnected under a new id, they match no tool. Settings still look correct and nothing reports a dead rule.
- No rule can be written for the new path. Putting `MULTI_EXECUTE_TOOL` itself in `ask` prompts on every read as well, and an `ask` pattern on the slug is impossible because the slug is an argument.

Writes to the vendor then run without a prompt. Nobody notices until someone audits why the confirmation stopped appearing.

## WRONG
```json
"permissions": {
  "ask": [
    "mcp__<old-server-id>__*Create*",
    "mcp__<old-server-id>__*Update*",
    "mcp__<old-server-id>__*Delete*"
  ]
}
```

## RIGHT
```json
"hooks": {
  "PreToolUse": [
    {
      "matcher": "^mcp__.*__MULTI_EXECUTE_TOOL$",
      "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR\"/.claude/scripts/vendor-write-ask.mjs" }]
    }
  ]
}
```
```js
// vendor-write-ask.mjs: read tool_input.tools[] from stdin and ask on any write slug.
const isWrite = (slug) =>
  slug?.startsWith("vendor__") &&
  (/Create|Update|Delete/.test(slug) || !/Get|List/.test(slug)); // an unknown verb asks
const tools = JSON.parse(readFileSync(0, "utf8"))?.tool_input?.tools;
const writes = Array.isArray(tools) ? tools.map((t) => t?.tool_slug).filter(isWrite) : ["(unreadable call)"];
if (writes.length) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: "PreToolUse", permissionDecision: "ask",
    permissionDecisionReason: `Vendor write: ${writes.join(", ")}` } }));
}
```
The hook sees the arguments, so it can ask on writes and stay silent on reads. It is also keyed to a matcher regex, so it is not tied to one connection id.

## NOTES
- Return the decision as JSON on stdout with exit 0. Plain stdout from a PreToolUse hook is not read, and exit 2 denies outright, which is stricter than "ask".
- When the payload can't be parsed, ask rather than allow. When the hook script itself crashes (exit 1, such as a syntax error), the call goes through unprompted. Spawn the script in a test that asserts the exact JSON decision. A `*/` inside a JS doc comment, such as "Get*/List*", is enough to break the script.
- The docs don't say whether a hook `ask` prompts under `bypassPermissions`. Tested 2026-11: `claude -p --permission-mode bypassPermissions` stopped a call to a fake, nonexistent write slug and returned the hook's reason. Interactive bypass was not tested, so keep a chat confirmation rule as well.
- For a subagent that must never write, deny in the agent's own frontmatter hook instead; see a-generic-mcp-executor-in-an-agent-s-tools-list-grants-every-write-behind-it.
- Check which verbs the vendor uses for writes. The pattern above assumes reads are named `<Object>Get...` or `<Object>List...`.
