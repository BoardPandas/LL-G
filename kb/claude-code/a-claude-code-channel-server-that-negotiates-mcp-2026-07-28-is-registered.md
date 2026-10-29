---
tech: claude-code
tags: [channels, mcp, stdio, notifications, protocol-version, research-preview]
severity: high
---
# A Claude Code channel server that negotiates MCP 2026-07-28 is registered without its channel, and every push is dropped silently

## PROBLEM

A Claude Code channel is a local stdio MCP server that declares `capabilities.experimental["claude/channel"]` and sends `notifications/claude/channel` to push an event into a running session (it wakes an idle one). Claude Code 2.1.308 opens every stdio server with a `server/discover` probe asking for MCP revision 2026-07-28. A server that answers the probe (the v2 SDK, `@modelcontextprotocol/server` 2.x with `serveStdio`) negotiates the modern revision, and Claude Code then registers it **without** the channel: its debug log says "Channel notifications skipped: connection negotiated a modern protocol revision with no unsolicited notification path". The server's tools still work, `--channels`/the development flag still shows it, and every notification it sends is discarded with no error on either side.

## WRONG

```js
// v2 SDK stdio server: looks right, connects, never delivers a push
const server = new McpServer({ name: "my-channel", version: "1.0.0" },
  { capabilities: { experimental: { "claude/channel": {} } } });
await serveStdio(server);
server.notification({ method: "notifications/claude/channel", params: { content: "hi" } }); // dropped
```

## RIGHT

Make the connection use the legacy handshake, so the channel registers ("Channel notifications registered" in the debug log):

- Hand-rolled JSON-RPC: answer `server/discover` with error `-32601` (method not found). Claude Code falls back to `initialize` (it asked for `2025-11-25`); answer that with the requested version and the `claude/channel` capability.
- Or keep the SDK and start the server with `MCP_PROTOCOL_NEGOTIATION=legacy`, which skips the discover probe.

Then verify with `claude --debug` (or the session debug log) that the line says "registered", not "skipped". Do not trust that the server "connected".

## NOTES

- Seen on Claude Code 2.1.308 with channels launched via `--dangerously-load-development-channels server:<name>`; channels are a research preview, so re-check on upgrade.
- The channel server gets `CLAUDE_CODE_SESSION_ID` in its environment, equal to the `session_id` in hook payloads, which is how a bridge can tell which session it serves.
- A remote HTTP MCP server cannot be a channel at all: Claude Code spawns channels as stdio subprocesses.
