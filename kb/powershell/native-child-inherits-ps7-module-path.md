---
tech: powershell
tags: [windows, powershell-7, powershell-5, go, child-process, cleanup, module-path, security]
severity: high
---
# Native child processes can carry PowerShell 7 module paths into Windows PowerShell 5.1

## PROBLEM

A program launched by `pwsh` 7 inherits `PSModulePath`. If that native program
later starts `powershell.exe` 5.1 with its inherited environment, module
autoloading can find incompatible PowerShell 7 modules. A fixed script containing
an ordinary command such as `Get-FileHash` may fail with an assembly-load error
although the file exists, permissions are correct, and the same command works in
an independently opened Windows PowerShell console.

`-NoProfile` does not sanitize the process environment. A retrying cleanup loop
can hide the first module error and eventually report only that cleanup timed out.
For an elevated child, caller-controlled module paths are also an inappropriate
code-loading boundary.

## WRONG

```go
// A Go program started from pwsh inherits its parent's PSModulePath.
cmd := exec.Command(systemPowerShell, "-NoProfile", "-NonInteractive", "-File", script)
err := cmd.Run() // nil Env inherits everything, including incompatible modules
```

## RIGHT

```go
// Obtain windowsRoot and systemDirectory from Windows APIs, not caller env.
// This fixed script requires only operating-system modules.
cmd := exec.Command(systemPowerShell, "-NoProfile", "-NonInteractive", "-File", script)
cmd.Env = []string{
    "SystemRoot=" + windowsRoot,
    "WINDIR=" + windowsRoot,
    "SystemDrive=" + filepath.VolumeName(windowsRoot),
    "PATH=" + systemDirectory + ";" + windowsRoot,
    "PSModulePath=" + filepath.Join(systemDirectory, "WindowsPowerShell", "v1.0", "Modules"),
}
err := cmd.Run()
if err != nil {
    // Report failure; do not infer that cleanup occurred from process launch.
    return err
}
```

## NOTES

- Scope the environment to what the actual fixed script needs. A general-purpose
  child that requires additional modules needs an explicit compatible allowlist.
- Test by deliberately poisoning the native parent's `PSModulePath`, launching
  the real Windows PowerShell child, and checking the resulting file operation.
  Cross-compilation does not exercise module resolution.
- Keep bounded diagnostic operation/error codes when cleanup retries. Do not log
  invitation-bearing filenames, credentials, or arbitrary script data.
- Observed in SupportForge Windows candidate run 36162649752; the isolated
  environment regression passed in run 36164101947 on September 25, 2026.
- Primary upstream discussion: https://github.com/PowerShell/PowerShell/issues/27774
