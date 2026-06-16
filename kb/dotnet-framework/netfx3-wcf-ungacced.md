---
tech: dotnet-framework
tags: [wcf, system.servicemodel, gac, netfx3, dism, windows-server-2025, in-place-upgrade, scm-1053, winsxs]
severity: high
---
# Server 2025 in-place upgrade leaves .NET 3.0 WCF (System.ServiceModel 3.0.0.0) un-GAC'd

## PROBLEM
A Windows Server 2025 in-place upgrade can leave the .NET Framework 3.0 WCF assemblies (System.ServiceModel 3.0.0.0, System.ServiceModel.Install, etc., PublicKeyToken b77a5c561934e089) staged in WinSxS but NEVER projected into the legacy GAC (C:\Windows\assembly\GAC_MSIL) -- even though the NetFx3 optional feature reports State=Enabled and sibling 3.5 assemblies (System.ServiceModel.Web, System.Workflow.*) ARE present.

Any legacy .NET 2.0/3.5 app or Windows service that binds System.ServiceModel 3.0.0.0 then dies at launch with System.IO.FileNotFoundException ("Could not load file or assembly 'System.ServiceModel, Version=3.0.0.0'"). As a Windows service this is maddening: SCM reports error 1053 / events 7000+7009 ("did not respond in a timely fashion" / "timeout reached while waiting to connect"), the app writes ZERO entries to its own log (the exception fires during logger/WCF init, before logging is set up), and the process dies in milliseconds so it may never even appear in a process list -- yet SCM still blocks for the full 30-45s start timeout. .NET 4 apps are unaffected because they bind System.ServiceModel 4.0.0.0, which lives in the separate v4 GAC (C:\Windows\Microsoft.NET\assembly).

## WRONG
```powershell
# Legacy .NET 3.5/WCF service fails: SCM 1053, events 7000/7009, no app log, no visible process.
# None of these fix it:
sfc /scannow
#  -> "Windows Resource Protection did not find any integrity violations"
#     (a missing GAC projection is not treated as a file-integrity fault)

DISM /Online /Enable-Feature /FeatureName:NetFx3 /All /Source:E:\sources\sxs
#  -> runs 0->100%, "completed successfully", but does NOT re-GAC:
#     the feature already reports Enabled, so nothing is re-projected.

ServiceModelReg.exe /i
#  -> crashes with the SAME FileNotFoundException: it depends on
#     System.ServiceModel.Install 3.0.0.0, which is also un-GAC'd (chicken-and-egg).
```

## RIGHT
```powershell
# 1. Prove the root cause: run the failing service EXE directly and read stderr.
& 'C:\Program Files\Vendor\LegacyService.exe'
#  -> System.IO.FileNotFoundException: System.ServiceModel, Version=3.0.0.0, ... b77a5c561934e089
Test-Path 'C:\Windows\assembly\GAC_MSIL\System.ServiceModel'   # False  = not projected
Get-ChildItem 'C:\Windows\WinSxS' -Recurse -Filter System.ServiceModel.dll  # files ARE present in WinSxS

# 2. Full re-deploy of NetFx3 from matching install media (both return 3010 = reboot required).
DISM /Online /Disable-Feature /FeatureName:NetFx3 /Remove /NoRestart
DISM /Online /Enable-Feature  /FeatureName:NetFx3 /All /LimitAccess /Source:E:\sources\sxs /NoRestart

# 3. REBOOT -- the legacy GAC projection of System.ServiceModel 3.0.0.0 finalizes ONLY on restart.
Restart-Computer

# 4. After reboot, verify the assembly is GAC'd, then the service starts and logs normally.
Test-Path 'C:\Windows\assembly\GAC_MSIL\System.ServiceModel\3.0.0.0__b77a5c561934e089'   # True
Start-Service 'CHO Jonas Service'
```

## NOTES
Diagnostic tell: SCM 1053 + zero entries in the app's own log + the process never visibly spawns = a load-time assembly failure before logging init. Always run the service exe by hand from a console to capture the real exception and the exact assembly+version; do NOT chase the misleading "timeout/did not respond" wording, which suggests a hang rather than a missing dependency.

The media source must match the OS build (e.g. Server 2025 = build 26100): mount the ISO and use `<drive>\sources\sxs`. Real case: Metro Club JONAS (Jonas Club Management timer + proxy services), Zendesk ticket 16302, 2026-06-16. Related: legacy WCF/.NET 3.5 line-of-business apps surviving a V2V + OS modernization.
