---
tech: powershell
tags: [windows, dotnet, processes, native-tests, startup, readiness, timeouts]
severity: medium
---
# Wait for child executable identity before taking a process snapshot

## PROBLEM

A Windows child returned by `[Diagnostics.Process]::Start()` is not necessarily
ready to supply every field needed for an identity manifest. An immediate
PowerShell `.Path` read can be unavailable even though the child exists.

A cross-process observer should reject that incomplete identity. The resulting
worker error can look like a protocol or permission failure, especially when the
same test passed in CI. Do not fix it by accepting an empty executable path,
guessing the path from launch arguments, or validating only the PID.

## WRONG

```powershell
$child = [Diagnostics.Process]::Start($info)
$identity = @{
    processId = $child.Id
    executable = $child.Path # Not guaranteed ready yet.
    startedAt = $child.StartTime.ToUniversalTime().ToString('o')
}
# Immediately publishing this can send an incomplete identity to the observer.
```

## RIGHT

Keep the exact owned Process object and its handle. Bound readiness separately
from the later join deadline. Stop on exit or inability to read identity.

```powershell
$child = [Diagnostics.Process]::Start($info)
[void]$child.Handle
$clock = [Diagnostics.Stopwatch]::StartNew()
$path = $null

do {
    $child.Refresh()
    if ($child.HasExited) { throw 'Owned child exited before identity was ready' }
    $path = $child.Path
    if ([IO.Path]::IsPathRooted($path)) { break }
    Start-Sleep -Milliseconds 20
} while ($clock.ElapsedMilliseconds -lt 5000)

if (-not [IO.Path]::IsPathRooted($path)) {
    throw 'Owned child executable identity did not become ready'
}
$identity = @{
    processId = $child.Id
    executable = $path
    startedAt = $child.StartTime.ToUniversalTime().ToString('o')
}
# Validate the manifest, then let the observer independently open/retain a handle
# and compare PID, executable path, and exact OS creation time.
# The owner must later join and dispose this exact child, including on failure.
```

## NOTES

- This is a readiness condition, not authorization. Only observe children or
  processes already approved and independently bound to the intended operation.
- Do not discover a substitute by process name or newest PID. Retain the original
  owned Process object and require the observer's independent exact identity check.
- `Refresh()` clears cached process-property data; a fixed sleep alone does not
  establish readiness. Keep a monotonic deadline and fail closed.
- Expose only allowlisted fixed diagnostic codes if error text could contain
  sensitive paths or manifest contents.
- The reproduced failure was an incomplete executable path in a native worker
  manifest on both Windows PowerShell 5.1 and PowerShell 7. A separate immediate
  child probe succeeded, so this is not an assertion that every start is affected.
- Deterministic tests should model delayed path publication, a path that never
  arrives, and a child that exits. Retain actual cross-process Windows tests too.
- A successful observer test is not proof that a remote capture protocol
  acknowledged shutdown or that an application-level cleanup was unforced.

Verified reproduction, native results and regression:
[SupportForge evidence](https://github.com/BoardPandas/supportforge-platform/blob/59fb72e7bc432a9887dc549dfba0b50255dd5419/tasks/evidence/2026-10-09-observer-startup-identity/README.md),
[regression](https://github.com/BoardPandas/supportforge-platform/blob/59fb72e7bc432a9887dc549dfba0b50255dd5419/desktop_agent_v2/tools/remote-viewer-acceptance/observer.test.ps1).

Related: [null exit-code observations](start-process-null-exit-code.md).
