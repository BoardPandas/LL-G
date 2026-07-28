---
tech: windows
tags: [power, sleep, standby, powercfg, rmm, remote-management, laptop, endpoint, flapping]
severity: medium
---
# An aggressive battery sleep timeout makes a laptop effectively unmanageable, and reads as a flaky agent

## PROBLEM
A laptop keeps appearing and disappearing from the RMM. Remote sessions die mid-command, `connect_agent`-style calls time out, and by the time you retry the endpoint is gone again. The natural conclusion is that the management agent is broken, so you restart services, reinstall agents, and chase ghosts.

The actual cause can simply be the power policy. A real case had:

    Current AC Power Setting Index: 0x00000000   (never)
    Current DC Power Setting Index: 0x000000b4   (180 seconds = 3 MINUTES)

On battery the machine slept after three minutes idle. The user was genuinely "using it all day", but every gap between keystrokes longer than three minutes dropped it off the network. Two days were lost trying to catch it awake.

This is worth checking early because the symptom (agent flapping) points at the wrong subsystem, and because the fix takes one command.

## WRONG
```powershell
# Symptom: agent shows online, then offline, then online.
# Conclusion jumped to: "the agent is broken"
Restart-Service <rmm-agent>       # ...then it vanishes again 3 minutes later
# or: tell the user to keep the laptop open and hope you catch the window
```

## RIGHT
```powershell
# 1. DIAGNOSE - read the actual timeout before blaming the agent.
#    0xb4 = 180 s. 0x708 = 1800 s. 0x00000000 and 0x7fffffff both mean "never".
powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE   | Select-String 'Power Setting Index'
powercfg /query SCHEME_CURRENT SUB_SLEEP HIBERNATEIDLE | Select-String 'Power Setting Index'

# 2. PIN IT OPEN for the maintenance window - capture the old values FIRST.
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0
powercfg /change hibernate-timeout-ac 0
powercfg /change hibernate-timeout-dc 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0   # 0 = do nothing
powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT

# 3. ALWAYS restore afterwards, especially the lid action.
powercfg /change standby-timeout-dc 30
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 1   # 1 = Sleep
powercfg /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 1
powercfg /setactive SCHEME_CURRENT
```

## NOTES
- **Leaving `LIDACTION 0` behind is a real hazard, not a cosmetic one.** The machine keeps running with the lid shut; in a bag it will overheat. Treat restoring it as mandatory, not best-effort, and verify rather than assume.
- **`powercfg /query ... SUB_BUTTONS LIDACTION` can return nothing** on builds where the setting is hidden, so a verification that greps its output silently "passes" having read nothing. Read the registry instead — it is authoritative:
  `HKLM:\SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes\<activeSchemeGuid>\4f971e89-eebd-4455-a8de-9e59040e7347\5ca83367-6e45-459f-a27b-476b1d01c936` → `ACSettingIndex` / `DCSettingIndex` (0 = do nothing, 1 = sleep, 2 = hibernate, 3 = shut down).
  Get the active scheme GUID from `powercfg /getactivescheme`.
- Distinguish "machine slept" from "agent broke" by comparing **two independent agents**. If both stop within seconds of each other, the endpoint left the network (power/Wi-Fi). If only one is quiet, that agent is the problem.
- `Win32_Battery.BatteryStatus = 2` means the device is on AC. Fixing sleep on AC alone is not enough for a laptop that spends its day undocked — set the DC timeout too, which is the one that is usually wrong.
- Beware the wrong lesson: 3 minutes is not a user setting anyone chose. It is usually inherited from a power policy pushed fleet-wide, so if one machine shows it, check the others and fix it at the policy layer rather than per-device.
