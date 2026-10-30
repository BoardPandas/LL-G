---
tech: godot
tags: [windows, powershell, headless, exit-code, console-exe, ci]
severity: high
---
# PowerShell does not wait for Godot's windowed exe on Windows, so a headless check run there tests nothing

## PROBLEM
On Windows, PowerShell returns immediately from Godot's windowed exe (`Godot_v4.x-stable_win64.exe`) with no output and an empty `$LASTEXITCODE`, so a headless test or smoke check run that way silently checks nothing.
It is not obvious because the same command works in Git Bash and cmd.exe: when output is redirected they wait for the process and pass stdout and the exit code through. A check verified in one shell becomes a no-op in another (a CI step, an npm script, a teammate's terminal). Observed on Godot 4.7.2 with a script that calls `quit(3)`: Git Bash and cmd reported 3; PowerShell reported nothing.

## WRONG
```powershell
& 'C:\tools\godot\Godot_v4.7.2-stable_win64.exe' --headless --path . -s res://tests/run.gd
if ($LASTEXITCODE -ne 0) { throw "tests failed" }   # $LASTEXITCODE is empty: never throws
```

## RIGHT
```powershell
# The _console.exe shipped in the same zip is a console-subsystem wrapper: every shell waits for it
& 'C:\tools\godot\Godot_v4.7.2-stable_win64_console.exe' --headless --path . -s res://tests/run.gd
if ($LASTEXITCODE -ne 0) { throw "tests failed" }   # exit code verified in PowerShell, cmd and Git Bash
```

```bat
@echo off
rem godot.cmd shim on PATH; pair it with an extensionless bash script for Git Bash
"C:\tools\godot\Godot_v4.7.2-stable_win64_console.exe" %*
exit /b %ERRORLEVEL%
```

## NOTES
- The console exe is a small (~200 KB) wrapper that starts the main exe from the same folder. Keep both files side by side under their original names and expose `godot` through a shim rather than renaming the wrapper.
- Also grep headless output for `SCRIPT ERROR`; a GDScript parse error under `-s` exited 1 in testing, but judge by output as well as exit code.
- Related: `windows/package-manager-versus-installed-product-identity` (a winget shim may point at the GUI exe).
