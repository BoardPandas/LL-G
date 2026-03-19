# cmd.exe does not support wildcards in the middle of a path

## Severity: HIGH

## PROBLEM

You need to run a command against a subfolder inside every user profile (e.g., delete all user temp files).

## WRONG

```cmd
del /s /q C:\Users\*\AppData\Local\Temp\*
```

Returns: `The filename, directory name, or volume label syntax is incorrect.`

cmd.exe only supports wildcards (`*`, `?`) in the **final segment** of a path. Wildcards in the middle of a path are not expanded -- the literal string `C:\Users\*\AppData\...` is passed to the filesystem, which rejects it.

## RIGHT

Use a `for /d` loop to enumerate the parent directory and build each path:

```cmd
for /d %u in (C:\Users\*) do rd /s /q "%u\AppData\Local\Temp"
```

In a batch file, double the `%`:

```cmd
for /d %%u in (C:\Users\*) do rd /s /q "%%u\AppData\Local\Temp"
```

## NOTES

- PowerShell handles mid-path wildcards fine (`Get-ChildItem C:\Users\*\AppData\Local\Temp`), so this is easy to forget when dropping to cmd.
- This matters most in zero-disk-space emergencies where PowerShell can't run due to script block logging overhead and cmd.exe is the only option.
