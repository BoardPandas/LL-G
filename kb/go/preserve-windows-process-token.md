---
tech: go
tags: [windows, process, token, impersonation, environment, security]
severity: high
---
# Preserve Windows process tokens when configuring flags

## PROBLEM

A shared hide-window/process-containment helper replaces cmd.SysProcAttr after
account selection sets Token. The command still starts successfully, but now
runs as the calling service, potentially SYSTEM, instead of the requested user.
Tests running everything as the test runner miss the identity change.

## WRONG

```go
cmd.SysProcAttr = &syscall.SysProcAttr{Token: syscall.Token(userToken)}
// Later helper silently discards the selected identity:
cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
```

## RIGHT

```go
if cmd.SysProcAttr == nil {
    cmd.SysProcAttr = &syscall.SysProcAttr{}
}
cmd.SysProcAttr.HideWindow = true
cmd.SysProcAttr.CreationFlags |= windows.CREATE_NO_WINDOW | windows.CREATE_SUSPENDED
```

## NOTES

Preserve every caller-provided process attribute. Validate the actual token SID
and Windows session before starting, and refuse unavailable accounts rather than
falling back. Build the selected token's environment with Environ(false) and use
its profile directory. A primary token needs TOKEN_QUERY and TOKEN_DUPLICATE for
CreateEnvironmentBlock; a query-only handle can validate identity but fail later
when constructing the environment. Keep tokens open through process creation.
A regression test should configure flags after assigning a nonzero Token and
assert the token survives; native tests should also verify account SID/profile.

https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-createenvironmentblock
