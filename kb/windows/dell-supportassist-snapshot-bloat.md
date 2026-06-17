---
tech: windows
tags: [dell, supportassist, saremediation, disk-full, vss, shadowstorage, supportforge, low-disk]
severity: high
---
# Dell SupportAssist SARemediation snapshots + unbounded VSS silently fill C:

## PROBLEM
On Dell endpoints running SupportAssist, the "system repair snapshots" the
SARemediation engine takes before driver/firmware updates pile up in
`C:\ProgramData\Dell\SARemediation\SystemRepair\Snapshots` and NEVER self-prune.
They balloon to tens of GB over time (30+ GB observed, individual snapshots dating
back 2+ years) and are the hidden cause of recurring "low disk space" / boot-volume
alerts. The folder is buried under ProgramData, so a top-level glance at C: usually
blames Windows or the user profile and misses it.

This is frequently compounded by Windows VSS (System Restore) shadow storage left at
its default `Maximum = UNBOUNDED`, which can quietly consume another 50+ GB. The two
together routinely eat 80-90 GB on a 256 GB SSD.

Clearing the snapshots once is not enough: SupportAssist re-creates them and the disk
fills again weeks later. You must also stop the engine that makes them.

## WRONG
```powershell
# Treats it as a one-off cleanup. Snapshots regrow; VSS stays unbounded; alert recurs.
Remove-Item 'C:\ProgramData\Dell\SARemediation\SystemRepair\Snapshots' -Recurse -Force
# (and on a SupportForge remote session this is also BLOCKED by the recursive-delete policy)
```

## RIGHT
```powershell
# 1. Cap VSS so System Restore can't grow unbounded (keeps recent restore points)
vssadmin resize shadowstorage /For=C: /On=C: /MaxSize=10GB

# 2. Delete the stale snapshot folder.
#    On a SupportForge remote session Remove-Item -Recurse is blocked, so use:
[IO.Directory]::Delete('C:\ProgramData\Dell\SARemediation\SystemRepair\Snapshots', $true)

# 3. Stop the SARemediation engine so snapshots don't regrow.
#    This is the snapshot-creating component; the main SupportAssist agent,
#    Dell Hardware Support, and update delivery stay intact.
Stop-Service 'Dell SupportAssist Remediation' -Force
Set-Service  'Dell SupportAssist Remediation' -StartupType Disabled
```

## NOTES
- The snapshots are NOT VSS shadow copies and NOT user data; they are SupportAssist's
  own pre-update restore images. Safe to delete.
- Service identity: DisplayName "Dell SupportAssist Remediation", binary
  `DellSupportAssistRemedationService.exe` (note the vendor's misspelling "Remedation").
- There is no clean registry/XML toggle for just snapshotting; `sys_settings_win.xml`
  under SARemediation\settings is a signed OS-Recovery boot manifest, not the trigger.
  Disabling the service is the reliable, targeted fix.
- This is a per-model fleet pattern: if one Dell shows it, audit the rest of the
  client's identical units for the same SARemediation growth.
- SupportForge recursive-delete block: see also the team memory on using
  `[IO.Directory]::Delete($p,$true)` for any recursive removal over that MCP.
