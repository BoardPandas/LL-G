---
tech: windows
tags: [go, winrt, graphics-capture, com, shutdown, resource-lifecycle, native-testing]
severity: high
---
# Closing a capture session does not join native apartment work

## PROBLEM

A Windows.Graphics.Capture session and frame pool can close successfully while
native work still depends on the apartment that hosted them. Retiring the last
COM worker immediately afterward can turn a successful Close acknowledgement
into a later native process crash. Reusing that worker's OS thread can expose a
different symptom: a later capture fails SetThreadDesktop with ERROR_BUSY.

On an authorized Windows 11 fixture, ordinary capture alone reproduced an
execution access violation after Close returned, without a viewer, encoder or
network connection. The debugger recorded first- and second-chance 0xC0000005
at an address most recently occupied by GraphicsCapture.dll, already unloaded.
A separate candidate that retired the Go OS thread instead of returning it to
the scheduler still crashed.

## WRONG

```text
Create a new COM worker for each capturer.
Close the WGC session and frame pool; release their interface references.
Stop that worker and uninitialize its apartment immediately.
Treat a Close reply or a printed test PASS as proof of clean native shutdown.
```

Keeping a temporary extra MTA alive was useful as a discriminator, but was not
itself a reliable correction: earlier repetitions still failed desktop
reattachment. Do not promote a successful subset of a mixed control.

## RIGHT

Separate bounded process infrastructure from per-capture ownership:

```go
// Sketch: COM initialization and every capture operation run on this worker.
var captureWorkerOnce sync.Once
var captureWorker *comThread
var captureWorkerErr error

func processCaptureWorker() (*comThread, error) {
    captureWorkerOnce.Do(func() {
        captureWorker, captureWorkerErr = startDesktopCOMThread(nil, "capture")
    })
    return captureWorker, captureWorkerErr
}

// Capturers borrow the worker. Close still closes and releases their session,
// pool, items, textures, factories and interfaces, and balances each capturer's
// WinRT initialization. It does not stop the process infrastructure owner.
```

Use this ownership choice only where one worker per process is explicitly
bounded and the process itself has a controlled lifetime. Do not retain capture
sessions or frame pools just to prevent a crash. Monitor/reset paths still need
fresh capture epochs, actual release and no lingering capture indicator.

Verify more than the protocol acknowledgement:

- Repeat capture/open-close in independent processes and record actual exit
  through a held process handle.
- Assert the worker is shared, capture epochs change and per-capture ownership
  is released. Test concurrent acquisition of the infrastructure owner.
- Retain unsuccessful controls and native load/unload/exception evidence.
- Verify full-product reset, desktop transitions, indicator disappearance and
  process exit separately before release.

The corrected fixture completed five independent processes, each with five
capture cycles, and all exited 0 without containment. Twelve concurrent callers
also shared one native worker. This is isolated ordinary-desktop evidence, not
proof for every Windows build, driver or full remote-support workflow.

## NOTES

- The observed fault was an execute access at GraphicsCapture.dll + 0x1115c.
  Older unloaded NVIDIA module ranges also overlapped that address; no
  symbolized native stack was obtained. Preserve this limitation rather than
  claiming a proven Windows-internal call chain.
- A debugger wrapper can exit 0 while its child exits 0xC0000005. Keep both
  process identities and outcomes.
- Go may park its startup OS thread rather than destroy it. A test that
  requires every exited locked goroutine's OS thread to become signaled can
  therefore misclassify the startup-thread case.
- Do not weaken DPI/physical-geometry checks or change display settings to get
  past an unrelated fixture failure. See [capture helper DPI awareness](capture-helper-dpi-manifest.md).
- Behavioral native regression coverage accompanies this fix; a static agent
  configuration guard cannot validate operating-system apartment lifetime.
- [Implementation, rejected controls and hash-bound native evidence](https://github.com/BoardPandas/supportforge-platform/blob/b1a63f81cd837e34fd9a25d9479f2ffa7ea887de/tasks/2026-10-11-wgc-apartment-lifetime-execution.md).
