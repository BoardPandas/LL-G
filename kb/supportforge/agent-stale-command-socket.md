---
tech: supportforge
tags: [agent, connect, command-socket, self-update, ninjaone, recovery, false-diagnosis]
severity: high
---
# "Launch was never delivered" is a stale command socket, not an offline machine — restart the agent service out-of-band

## PROBLEM
`connect_agent` fails and the error text tells you which of two very different situations you are in. They are easy to conflate, and conflating them costs hours because one is fixable in seconds and the other is not fixable at all from your side.

    A) "Agent <host> is offline (last seen: ...). It must be online to connect."
       -> the machine really is not reachable. Nothing you do server-side helps.

    B) "Agent <host> did not connect within 45 seconds. The launch was never delivered —
        no API instance holds this agent's command socket, so the agent never saw it."
       -> the machine IS up and heartbeating. Only the command socket is stale.
          The agent service just needs restarting.

Variant B is commonly triggered by the **agent self-updating mid-session**. A real case: the agent updated itself from 3.0.2.0 to 3.8.5.4, kept heartbeating afterwards (so `list_agents` showed `online`), but its command socket was never re-established, so every connect attempt died at 45s.

There is a third, nastier variant: `connect_agent` returns "Already connected to agent ... (session: X)" while every `execute_command` against it returns "Agent is not connected". That is a stale MCP session mapping — disconnect and reconnect.

## WRONG
```
connect_agent(agentId)            -> "launch was never delivered"
# read as "it must be offline", tell the user to power the laptop on,
# and wait. The machine was online the whole time.

connect_agent(agentId)            -> "Already connected (session: X)"
execute_command(agentId, "...")   -> "Agent is not connected"
# retry execute_command in a loop against a dead session mapping
```

## RIGHT
```python
# 1. Read the error text. "launch was never delivered" == machine is UP.
#    Confirm independently before acting - a second agent is the cleanest cross-check.
#    If SupportForge and NinjaOne both went quiet within seconds of each other,
#    the MACHINE dropped. If only SupportForge is quiet, the SOCKET is stale.

# 2. Restart the agent service out-of-band via the RMM. This works with a
#    NinjaOne client_credentials key (scripting does NOT - see kb/ninjaone).
POST /device/{ninjaDeviceId}/windows-service/SupportForgeAgent/control
{"action": "RESTART"}                      # -> 204, empty body

# 3. Wait for re-registration, then connect. lastSeen should jump to ~now.
list_agents(search=host)                   # status: online, fresh lastSeen
connect_agent(agentId)                     # connects first try

# For the stale-mapping variant:
disconnect_agent(agentId="all")
connect_agent(agentId)
```

## NOTES
- The Windows service is named **`SupportForgeAgent`** (display "SupportForge Agent", LocalSystem, AUTO_START). Note the *Add/Remove Programs* list can show two SupportForge entries (e.g. a per-client "SupportForge Agent - <Client>" and "SupportForge Agent - SupportForge Generic") while only **one** service is actually registered — do not go hunting for a second service to restart.
- **Cross-check with a second agent before blaming the tooling.** Two independent agents (SupportForge + NinjaOne) going quiet within the same few seconds means the endpoint left the network. Only SupportForge quiet while Ninja still reports fresh `lastContact` means the socket is stale and a service restart will fix it. This one comparison decides whether you chase the user or chase the agent.
- RMM dashboards cache device state. A device can render green in the NinjaOne UI for minutes after it dropped, so "I can see it online right now" is not a contradiction of an offline API result — compare `lastContact` timestamps, not badges.
- Related: [Script execution has TWO separate blockers](../ninjaone/no-adhoc-script-execution.md) for why you cannot just run a restart script instead, and [execute_command can return another session's output](execute-command-cross-session-output.md) for why to pass `agentId` explicitly once more than one session exists.
