---
tech: ninjaone
tags: [installation, enrollment, hardware-lock, decommissioned, silent-failure, agent]
severity: high
---
# Silent NinjaOne agent self-uninstall from decommissioned hardware lock

## PROBLEM
A NinjaOne agent MSI can install cleanly (exit code 0, service appears) and then silently remove itself within ~15 seconds, leaving no device in the console and no obvious error to the technician. The cause is a server-side hardware lock: NinjaOne identifies devices by service tag / BIOS serial number, and if that hardware was previously enrolled and later DECOMMISSIONED, the backend rejects the new node registration and instructs the agent to uninstall. The decommissioned record is hidden from normal device queries, so the technician has no visible reason for the failure and may reinstall repeatedly with the same result.

## WRONG
```
# Repeatedly reinstalling the MSI when the agent keeps disappearing.
# MSI returns exit 0, NinjaRMMAgent service starts, then vanishes.
# The blocking record is invisible to a normal device list:
ninjaone_search_devices(query="SPAREPC4")        # returns nothing
ninjaone_list_devices()                          # decommissioned devices excluded

# Conclusion "the installer is broken" -- wrong. Reinstalling never fixes it.
```

## RIGHT
```
# 1. Read the agent log to see the real reason for the self-removal:
#    C:\ProgramData\NinjaRMMAgent\logs\NinjaRMMAgent_*.log
#    Failing run shows:
#      resultCode: UNINSTALL
#      errorMessage: "Node registration was rejected, node is decommissioned"

# 2. Surface the hidden decommissioned record by filtering on status:
ninjaone_api_call(method="GET", path="/devices?df=status%20%3D%20DECOMMISSIONED")
#   or via a query helper with df="status = DECOMMISSIONED"
#   -> reveals the old record bound to the same service tag (e.g. SPAREPC4, id 1779,
#      service tag 7Y27MC4)

# 3. Delete the decommissioned record in the NinjaOne console (not just decommission
#    again -- it must be removed to release the hardware lock).

# 4. Reinstall the MSI. The log now shows:
#      resultCode: SUCCESS
#      approvalStatus: APPROVED
```

## NOTES
- The lock is keyed on hardware identity (service tag / BIOS serial), not hostname. A machine renamed or repurposed (e.g. an old SPAREPC reused as a workstation) still carries the old hardware identity.
- MSI exit code 0 means "files installed," NOT "agent enrolled." Always confirm enrollment in the console or via the agent log `resultCode`, never by installer exit code alone.
- Decommissioned devices are excluded from `ninjaone_list_devices` and `ninjaone_search_devices`. Use `df="status = DECOMMISSIONED"` to find them.
- Symptom signature: agent service appears then disappears in ~15 seconds; no device ever shows in the org.
