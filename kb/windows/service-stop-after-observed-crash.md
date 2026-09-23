---
tech: windows
tags: [windows-service, scm, controlservice, cleanup, process-handle, go, fault-injection]
severity: medium
---
# Stopping an already observed crashed service can falsely fail cleanup

## PROBLEM

A Windows service fault test waited on its bound own-process service handle and
observed the deliberately requested exit code 139. Its watchdog then sent
SERVICE_CONTROL_STOP anyway. On the measured Windows 11 system, ControlService
returned Win32 1067 (ERROR_PROCESS_ABORTED). The blanket cleanup-error recorder
turned the entire run into cleanup_failed, even though the desktop child exited
and the exact service registration was subsequently proved absent.

The stale stop request is unnecessary once that specific service process exit
has already been established. Ignoring error 1067 everywhere would hide other
service failures and is not the correction.

## WRONG

```go
faultObserved := waitForBoundServiceExit(serviceProcess, 139)
_, err := service.Control(svc.Stop)
recordCleanupError(err) // Can record 1067 after the already verified crash.
```

## RIGHT

```go
faultObserved := waitForBoundServiceExit(serviceProcess, 139)
if !faultObserved {
    _, err := service.Control(svc.Stop)
    recordStopResult(err)
}
// In either branch, still delete/close the exact owned service, verify the
// desktop child's exit, and require ERROR_SERVICE_DOES_NOT_EXIST on readback.
verifyOwnedCleanup()
```

## NOTES

- This was an isolated own-process service with recovery disabled, marked for
  deletion before handing off its child. Do not infer that a shared service or
  restartable service is stopped merely because an earlier process exited.
- Hold the verified original process handle. A PID-only lookup after the fact
  can refer to a different process.
- Skip the redundant control only after observing the expected bound-process
  exit. Keep timeout, wrong-exit and unknown-state paths conservative.
- The corrected live test observed exit 139, child exit, service absence and
  cleanup-owner exits with a successful verdict. Preserve the original failed
  receipt rather than rewriting its error as a pass.
- This observation does not claim that every ControlService call after an exit
  returns 1067. It documents one measured failure and a narrower control flow.
- Microsoft documents [ControlService](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/nf-winsvc-controlservice)
  and the [system error codes](https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--1000-1299-).
