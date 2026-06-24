---
tech: supportforge
tags: [supportforge, disk-space, remote-execution, redis, session, mcp, endpoint-remediation]
severity: high
---
# "Online" agent at near-full disk is a heartbeat, not a working executor

## PROBLEM
A SupportForge agent on a box at sub-1% free disk reports `status: "online"` (it is still posting Redis heartbeats), so it looks fully remediable. It is not. At that fill level the machine is paging to death and the agent's command/file executor is hung: typically exactly ONE command completes per session (whatever read you run first), and every subsequent `execute_command` / `write_file` returns `Error: Session not found or has ended` — even after `disconnect_agent` + a fresh `connect_agent`. You can burn many cycles reconnecting and re-issuing commands, each dying after one op or none, before realizing the executor will never finish work.

The trap: the "online" flag is a liveness heartbeat, not a guarantee the executor responds. The very condition you are trying to fix (no free disk) is what prevents the agent from running the fix. And you cannot pair a reboot with remote cleanup, because a reboot ends the SupportForge session.

## WRONG
```text
# list_agents shows status: "online" → assume it can be remediated remotely
connect_agent(...)                         # succeeds
execute_command("Get-CimInstance ...")     # works (first command)
execute_command("<cleanup deletes>")       # "Session not found or has ended"
disconnect_agent(); connect_agent(...)     # reconnects
write_file("C:\cleanup.ps1", ...)          # "Session not found or has ended"
# ...repeat forever; the box at 0.7% free can never complete the work
```

## RIGHT
```text
# Treat "online" as necessary-but-not-sufficient. If the box is at <~2% free
# AND commands die after one op, STOP retrying — the executor is hung, not flaky.
connect_agent(...)
freePct = execute_command("Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='C:'\" ...")
if (freePct < ~2 and next command returns "Session not found or has ended") {
  # Do NOT keep reconnecting. The disk must be relieved out-of-band first:
  #   - hands-on at the device, or
  #   - a reboot to reclaim pagefile/temp (note: reboot ends the SF session,
  #     so it cannot be combined with remote cleanup in the same pass)
  # Then re-attempt remediation, or use the durable fix for that box's root cause.
  flag_for_hands_on_followup()             # leave the alert active; it is not fixed
}
```

## NOTES
Discovered on CCC POOL-WS1 (NinjaOne dev 1488) at 0.7% free (0.79 GB) during a low-disk alert sweep, 2026-06-24. Distinct from the *post-restart* instability where `connect_agent` succeeds but the first few commands fail for ~1-2 min after a `SupportForgeAgent` service restart (that one self-heals after a short wait; this one does not — only freeing disk fixes it). Related: the standard SupportForge gotchas (recursive-delete block → use `[IO.Directory]::Delete`/`[IO.File]::Delete`; 300s cap; reboot ends session). When a box is this full, the param-driven NinjaOne Script Runner path (or hands-on) is the fallback, not SupportForge.
