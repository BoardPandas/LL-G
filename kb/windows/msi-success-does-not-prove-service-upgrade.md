---
tech: windows
tags: [msi, windows-installer, service, upgrades, verification, supportforge]
severity: high
---
# MSI success and product version do not prove service binary replacement

## PROBLEM

A repeated MSI install can exit zero while its service executable remains an older
build. The uninstall registry can already advertise the target product version.
Neither fact establishes the version of the executable the running service uses.

During an agent rollout, the registry advertised 3.251.1.1 and repeated installation
logs returned zero, but the service kept reporting 3.209.1.0. Its executable hash
and file dates remained unchanged. The MSI log showed the ServiceExe component
as Installed: Local, Request: Null, Action: Null. That proves this invocation did
not schedule replacement; it does not establish why an earlier install left the
old file behind. Repeating the same install also disrupted technician sessions
as the updater stopped sibling processes.

## WRONG

```powershell
$p = Start-Process msiexec.exe -ArgumentList @('/i', $msi, '/quiet', '/norestart') -Wait -PassThru
if ($p.ExitCode -eq 0) { 'Upgrade verified' }
```

Do not substitute the uninstall registry's DisplayVersion or an About dialog for
the running service's build. Do not assume unversioned files always get replaced
merely because the package contains a different hash.

## RIGHT

Separate artifact verification, installer outcome, installed-file evidence and
runtime evidence. Verify the MSI against its published checksum before execution.
After completion, resolve the service's actual executable and new process, compare
its hash with the expected service artifact when available, and require a fresh
server heartbeat reporting the target build. Preserve the registered device identity
and verify reconnection before declaring the repair complete.

```powershell
$svc = Get-CimInstance Win32_Service -Filter "Name='SupportForgeAgent'"
if ($svc.State -ne 'Running') { throw 'Service has not recovered' }
$process = Get-Process -Id $svc.ProcessId
[pscustomobject]@{
    ProcessId = $svc.ProcessId
    StartedAt = $process.StartTime
    BinaryPath = $process.Path
    SHA256 = (Get-FileHash -LiteralPath $process.Path -Algorithm SHA256).Hash
}
# Correlate these observations with the expected artifact and a fresh server
# heartbeat. Collecting the fields by itself is not a successful upgrade check.
```

## NOTES

Inspect the specific component's requested/action state in a verbose MSI log.
Choose a scoped repair based on those facts and preserve enrollment/configuration
in an ACL-protected backup. Blanket force-overwrite across the fleet is not a
substitute for understanding file/component state. A repair script that has not
run successfully remains unverified.

Microsoft documents [file replacement rules](https://learn.microsoft.com/en-us/windows/win32/msi/replacing-existing-files)
and distinct [install and repair options](https://learn.microsoft.com/en-us/windows/win32/msi/command-line-options).

NinjaOne service inventory is also not guaranteed to be a current process check:
in this investigation it still reported STOPPED after a new-version server
heartbeat had already arrived. Correlate timestamps and endpoint evidence.
