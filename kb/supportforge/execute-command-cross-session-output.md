---
tech: supportforge
tags: [execute_command, remote-session, multi-agent, session-routing, cross-talk, verification]
severity: high
---
# execute_command can return another session's output when multiple agent connections are open

## PROBLEM
With two or more desktop-agent connections open in the same technician session, an `execute_command` call targeted at one agent (correct `agentId` passed) can come back with output that belongs to a different session entirely -- e.g. a connectivity test sent to a POS terminal returned a `Get-Printer` listing from some other machine. The result looks like a normal successful response, so nothing flags it as misrouted. If the misrouted output happens to look plausible, you will make decisions (or run destructive follow-ups) based on the wrong machine's state.

## WRONG
```text
execute_command(agentId: "...-agent-pos6", command: "Test-NetConnection FILE -Port 445")
# Response: a printer list from a different machine -- silently trusted as pos6's state
```

## RIGHT
```powershell
# Prefix EVERY remote command with a hostname echo and check it before trusting the output:
"RUNNING ON: $(hostname)"; <actual command>

# If the echoed hostname does not match the intended target, discard the output,
# re-verify the session with get_system_info, and re-run.
```

## NOTES
- `get_system_info` on the same agentId returned the correct machine even while `execute_command` output was crossed, so a one-time identity check is not sufficient -- guard every command.
- Observed with 3 concurrent connections (one pre-existing from an earlier session). Disconnecting stale sessions (`disconnect_agent` with "all") before starting work reduces the exposure.
- This matters most for state-changing commands: never run a config change on the basis of an unguarded read from a multi-connection session.
