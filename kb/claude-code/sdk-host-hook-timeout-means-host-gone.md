---
tech: claude-code
tags: [hooks, pretooluse, sdk, desktop-app, ssh-remote, mcp, connectors, timeout, host-callback]
severity: high
---
# "PreToolUse hook did not respond (host client may be unreachable)" is the SDK host's hook, not yours

## PROBLEM
When Claude Code is driven by an SDK host, such as the Claude desktop app's Code tab running a
session on a remote Linux box over SSH, the host registers its **own** PreToolUse hooks. It sends
them in the `initialize` control request as `{matcher, hookCallbackIds, timeout}`, and the CLI
answers each one by sending `{subtype: "hook_callback", ...}` back over the control stream.

If the host machine restarts, sleeps, or loses the link, the remote daemon keeps the CLI process
alive and the session carries on. Bash, Edit and every project command hook in
`.claude/settings.json` still run locally and still work. But every tool matched by a host
callback waits out the host-chosen timeout (observed: 30 s for MCP connector tools, 600 s for
Workflow) and is refused:

```text
PreToolUse hook did not respond before its timeout (host client may be unreachable). The tool call was not executed; other configured hooks may not have completed.
```

The message names PreToolUse and hits only some tools, so it reads as "one of my hooks is slow or
broken", especially when the repo has a `matcher: "*"` gate. The natural fix is to add a
`timeout` to that hook, fast-path it or loosen it. None of that can help, because the hook that
timed out belongs to the host. Loosening a safety gate for this weakens it for nothing.

Evidence (2026-09-30, CLI 2.1.284):
- In the CLI source, this string is raised only in the branch that logs `PreToolUse hook timed out
  (per-hook abort)` and emits telemetry `tengu_sdk_hook_callback_timeout`. The neighbouring branch
  handles "control stream closed", so the CLI's stdio was fine and the far end never answered.
- The workstation's Windows System log shows a user-initiated restart (User32 1074) in the same
  second that sshd logged `Connection reset by peer` from it.
- Six connector calls failed at exactly +30.0 s while Bash in the same session succeeded.
- The repo's `*` gate hook measured 3-45 ms.
- A second incident matched an RMM patch reboot of the workstation at 05:00, during an overnight
  session.

**It outlasts the reconnect.** The host reconnected at 10:35, a call at 10:36 still failed, and
calls only worked after the session was reopened at 10:57, which made the host restart its CLI.

## WRONG
```jsonc
// "The * hook must be timing out on MCP calls" -- give it a timeout / fast path / looser matcher
{ "matcher": "*", "hooks": [{ "type": "command", "timeout": 60,
  "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/scripts/require-ticket-release.sh\"" }] }
// ...then retry the connector call in a loop. Every retry burns another 30 s.
```

## RIGHT
```bash
# 1. Measure: a flat 30.0 s (or 600.0 s) from call to error is the host's ceiling, not a slow script.
# 2. Confirm the host went away (on the remote box):
journalctl --since "-1h" -g 'Read error from remote host'            # "Connection reset by peer"
grep -h 'Connection closed\|New connection' ~/.claude/remote/run/*/remote-server.log | tail
# 3. On the host machine, look for restart/sleep (Windows: System log 1074, Kernel-General 12/13, 42/107).
# 4. Stop retrying connector calls; local tools still work.
# 5. After the host reconnects, REOPEN the session (the host restarts its CLI), then prove the
#    connector with a trivial read before resuming.
```

## NOTES
- A sibling signature, `Tool call timed out waiting for server response.`, is a separate **fixed
  ~180 s client-side ceiling** on every connector call. It showed up 33 times at 180.06-185.5 s,
  whatever the tool's own `timeout` argument was (30-420). The string is absent from the CLI
  binary, so it comes from the host or the connector proxy. Keep a remote-exec tool's `timeout`
  below ~165 s and background anything longer on the target.
- Related: permission-prompt-tool-needs-initialize (how SDK hosts drive the CLI),
  merge-conflict-in-every-tool-hook-locks-agent-out (a different way a `*` hook blocks every tool).
