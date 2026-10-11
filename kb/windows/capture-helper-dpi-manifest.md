---
tech: windows
tags: [dpi, wgc, capture, manifest, go, remote-desktop, native-testing]
severity: high
---
# Capture helpers need their own embedded DPI-awareness manifest

## PROBLEM

A background capture helper is a separate process, even when it is launched by
a DPI-aware viewer or service. Without its own DPI declaration, APIs used to
enumerate monitors can expose virtualized geometry while
Windows.Graphics.Capture reports physical pixels. A correct geometry check
then rejects the capture source. If startup only reports EOF, the defect looks
like a broker, token, or graphics-driver failure instead of a coordinate mismatch.

On a native Windows 11 3840x2160 scaled-display fixture, an ordinary-user helper
launched by SYSTEM failed specifically at the unchanged WGC monitor-geometry
check. Embedding a per-monitor DPI manifest in the same helper entry point
made it initialize and report 3840x2160. Three console-subsystem and three
production-style GUI-subsystem starts then completed with protocol Close
acknowledgements, natural child exits, and no containment or leftover children.
These were startup checks, not video-quality or latency acceptance.

## WRONG

```text
Build the remote helper as a plain Go EXE with no manifest resource.
Assume the launching viewer's DPI awareness applies to the helper.
On WGC/monitor disagreement, discard the geometry check or resize the fixture.
```

## RIGHT

Declare DPI awareness in the helper's own executable manifest before startup:

```xml
<application xmlns="urn:schemas-microsoft-com:asm.v3">
  <windowsSettings>
    <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
    <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2, PerMonitor</dpiAwareness>
  </windowsSettings>
</application>
```

Embed it as RT_MANIFEST resource ID 1 in the final PE. For a plain Go executable,
compile a target-matched resource object before linking. Refuse an unexpected
pre-existing object, fail on resource/compiler errors, and remove only the
build-owned generated object afterward. Preserve the original privilege level;
DPI awareness does not require elevation or UIAccess.

Inspect the completed EXE resource, then test the actual ordinary-user capture
path on an independently measured high-DPI monitor. Keep the capture source's
physical-geometry equality check strict. Scope startup diagnostics to closed
stage codes and native error numbers instead of arbitrary private launch text.

## NOTES

- The manifest must be embedded in every relevant executable. An adjacent
  source XML file alone is not proof that the shipped PE contains it.
- On this fixture, both GetProcessDpiAwareness and
  GetDpiAwarenessContextForProcess rejected a launch-held cross-session process
  query from session 0. Those failed observers were preserved, not called
  passes. The final functional oracle compared the broker's primary monitor
  with independently measured physical dimensions and retained WGC's own
  physical-size check. Do not generalize that observer limitation to all Windows
  versions or replace identity validation with PID-only lookup.
- A startup fix does not establish moving-text clarity, bitrate compliance,
  latency, secure-desktop support, or full two-role shutdown acceptance. Measure
  those separately before promotion.
- Microsoft recommends setting the process default through the application
  manifest: https://learn.microsoft.com/en-us/windows/win32/hidpi/setting-the-default-dpi-awareness-for-a-process
- Related resource-linker caveat: [Go COFF resources](go-coff-resource-conversion.md).
- Investigation and native evidence: https://github.com/BoardPandas/supportforge-platform/issues/307
