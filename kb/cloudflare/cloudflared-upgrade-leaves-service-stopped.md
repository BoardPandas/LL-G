---
tech: cloudflare
tags: [cloudflared, cloudflare-tunnel, windows-service, winget, service-recovery, ninjaone, rmm]
severity: high
---
# cloudflared upgrade leaves the Windows service Stopped (graceful stop bypasses recovery + auto-start)

## PROBLEM
When cloudflared is updated on Windows (via a winget "upgrade all" job or its own updater), the update **gracefully stops the `Cloudflared` service to swap the binary and does NOT reliably restart it**. The service then sits Stopped and never self-heals, silently dropping the tunnel until the next reboot or a manual start. The binary and tunnel token are intact the whole time, so it looks healthy on disk while the tunnel is down.

Why it does not self-heal (all three safety nets miss this case):
- The stop is **graceful, not a crash**: SCM logs event **7036** "entered the stopped state", and the cloudflared Application log shows `cloudflared starting graceful shutdown` -> `terminated without error`. There is no 7031.
- The service's `sc` **failure/recovery action** (e.g. RESTART after 20s) only fires on **unexpected termination (event 7031)**. A graceful/external stop never triggers it.
- **StartType Automatic only launches the service at boot.** If the machine does not reboot, it stays Stopped indefinitely.

Observed 2026-07-09 on two Windows Server 2022 boxes after a NinjaOne winget upgrade-all job pushed cloudflared 2026.7.0; both tunnels down, `Start-Service Cloudflared` restored them with no reinstall. Second update cycle it bit.

Detection: service name `Cloudflared` (display "Cloudflared agent"), Automatic / LocalSystem, token embedded in the service binPath:
`"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel run --token <...>`

## WRONG
```powershell
# Assuming device-side recovery / auto-start will bring cloudflared back after an update.
# It won't for a graceful stop:
sc.exe qfailure Cloudflared        # FAILURE_ACTIONS: RESTART after 20s -- only fires on 7031 crash
Get-Service Cloudflared            # StartType Automatic -- only starts at BOOT
# After a winget/self-upgrade graceful stop (SCM 7036), the tunnel stays down silently
# until someone reboots or manually starts it. No alert, binary looks fine.
```

## RIGHT
```powershell
# Immediate fix -- binary + token survive the upgrade, just start it:
Start-Service Cloudflared
Get-Service Cloudflared | Format-List Name,Status,StartType

# Confirm the graceful-stop signature when diagnosing:
Get-WinEvent -LogName Application -MaxEvents 200 |
  Where-Object ProviderName -match 'cloudflared' |
  Select-Object TimeCreated,Message -First 5
# -> "cloudflared starting graceful shutdown" / "terminated without error"
```

Durable fix: monitor at the **RMM layer**, not the device. Device-side `sc` recovery actions and Automatic-start-at-boot do NOT catch a graceful stop. In NinjaOne, add a native **Windows Service** condition (service `Cloudflared`, state Down) with a **Start-service automation** (immediate restart) + **Critical alert** if it stays down past a short threshold, auto-reset "when no longer met".

## NOTES
- Applies to any long-running cloudflared tunnel installed as a Windows service (`cloudflared service install`), not just NinjaOne-managed fleets. Any updater that stops-then-swaps the binary can leave it down.
- NinjaOne condition/monitor authoring is **UI-only** (no API/MCP endpoint to create conditions), same family as the "no ad-hoc script execution" NinjaOne limitation -- see kb/ninjaone.
- Software-inventory filters lag: a freshly-upgraded host may be missing from an RMM "software = cloudflared" filter the same day; verify the actual service on the endpoint before trusting inventory for scoping.
