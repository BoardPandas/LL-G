---
tech: supportforge
tags: [execute_command, write_file, defender, base64, powershell, false-positive]
severity: high
---
# A base64 script decoded with FromBase64String in execute_command is blocked by Defender as Powdow

## PROBLEM
Passing a script to `execute_command` as a base64 blob that the command line decodes with `[Convert]::FromBase64String` is blocked by Microsoft Defender at process start as `Trojan:PowerShell/Powdow.RRA!MTB`, and the tool returns only `fork/exec ...powershell.exe: Access is denied.`
The error reads like a permissions or agent problem, not antivirus, and plain PowerShell commands keep working, so it is easy to misdiagnose. The block also raises a malware detection (event 1116) on the endpoint that the client's security team or RMM will see.

## WRONG
```powershell
$b='JG91dCA9ICdDOlxQcm9n...'
[IO.File]::WriteAllText('C:\ProgramData\Tool\size.ps1',
  [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)))
```

## RIGHT
```text
1. write_file  path: C:\ProgramData\Tool\size.ps1  content: <plain-text script>
2. execute_command: powershell -NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\Tool\size.ps1
   (or register it as a detached SYSTEM scheduled task for long runs, and poll an output file)
```

## NOTES
Check whether a block fired with `Get-MpThreatDetection` or the `Microsoft-Windows-Windows Defender/Operational` log, event 1116, and tell the client it was a false positive you caused. `-EncodedCommand` is flagged the same way. Remove any script and scheduled task you landed when done. See also supportforge/write-file-chunk-verify-transfer and supportforge/write-file-redacts-password-registry-read.
