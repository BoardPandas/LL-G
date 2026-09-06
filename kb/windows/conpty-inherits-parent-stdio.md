---
tech: windows
tags: [conpty, console, redirected-stdio, createprocess, startupinfoex, go]
severity: high
---
# ConPTY children can inherit redirected parent standard handles

## PROBLEM
A child launched with STARTUPINFOEX, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
and EXTENDED_STARTUPINFO_PRESENT can still send its prompt/output to the
parent process's redirected stdout instead of the pseudoconsole pipe.
CreateProcess succeeds, the child runs, and the browser terminal remains
blank. Native CMD and PowerShell tests exposed this on Windows 11 under a
Go test runner with captured output.

## WRONG
```cpp
STARTUPINFOEXW si{};
si.StartupInfo.cb = sizeof(si);
// Correct pseudoconsole attribute is attached, but standard handles are implicit.
CreateProcessW(..., FALSE, EXTENDED_STARTUPINFO_PRESENT, ..., &si.StartupInfo, ...);
```

## RIGHT
```cpp
STARTUPINFOEXW si{};
si.StartupInfo.cb = sizeof(si);
si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
si.StartupInfo.hStdInput = nullptr;
si.StartupInfo.hStdOutput = nullptr;
si.StartupInfo.hStdError = nullptr;
// Also attach the pseudoconsole attribute and pass EXTENDED_STARTUPINFO_PRESENT.
CreateProcessW(..., FALSE, EXTENDED_STARTUPINFO_PRESENT, ..., &si.StartupInfo, ...);
```

## NOTES
Use explicit null standard handles to prevent inheritance from overriding
ConPTY. Keep handle inheritance false. Do not redirect the child using the
ordinary stdin/stdout pipe setup as well.

Test the native prompt before sending a command, including under a parent
with redirected I/O. Test both CMD and PowerShell; mocks of CreateProcess or
console creation cannot detect this. Drain output concurrently through
ClosePseudoConsole so final output is flushed without deadlock.

Microsoft discussion: https://github.com/microsoft/terminal/discussions/15814
