---
tech: windows
tags: [go, github-actions, coff, resource, windres, cvtres, signing]
severity: medium
---
# Windows SDK resource conversion is not necessarily Go linker compatible

## PROBLEM

A Windows VERSIONINFO or application manifest can compile successfully with
Windows SDK `rc.exe`, then convert successfully with MSVC `cvtres.exe`, but fail
when Go's internal PE linker reads the resulting `.syso`. The MSVC COFF object
can contain absolute symbols that Go's COFF reader rejects with `sectnum < 0!`.
Successful resource compilation and conversion do not establish Go compatibility.

## WRONG

```powershell
& $rc /nologo /fo app.res app.rc
& $cvtres /MACHINE:X64 /OUT:version_windows_amd64.syso app.res
go build ./cmd/app
# The Go link can fail even when rc and cvtres exited 0.
```

## RIGHT

```powershell
& $rc /nologo /fo app.res app.rc
if ($LASTEXITCODE -ne 0) { throw 'Resource compilation failed' }
& $windres -J res -O coff --target pe-x86-64 -i app.res -o version_windows_amd64.syso
if ($LASTEXITCODE -ne 0) { throw 'Go-compatible resource conversion failed' }
go build ./cmd/app
if ($LASTEXITCODE -ne 0) { throw 'Executable build failed' }
```

## NOTES

- This example targets Windows amd64; do not reuse its COFF architecture for
  another target.
- Resolve the actual SDK/GNU tools on the build runner and fail if unavailable.
  The SupportForge runner already had GNU windres; no new repository dependency
  was required.
- Verify the completed EXE's version/product resources, then sign the completed
  bytes and verify its signature. Do not add or patch resources after signing.
- Observed with Go's internal Windows PE link in SupportForge candidate run
  36160031569. The GNU conversion built successfully and the resulting payloads
  passed native version/signature trust checks in run 36165035861.
