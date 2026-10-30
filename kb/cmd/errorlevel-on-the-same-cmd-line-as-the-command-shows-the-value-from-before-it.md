---
tech: cmd
tags: [errorlevel, exit-code, delayed-expansion, windows, git-bash]
severity: high
---
# %ERRORLEVEL% on the same cmd line as the command shows the value from before it ran

## PROBLEM
`cmd /c "tool & echo exit=%ERRORLEVEL%"` prints the ERRORLEVEL from before `tool` ran, because cmd expands `%VAR%` for the whole line when it parses it, so a failing command reports `exit=0`.
It is not obvious because the output looks like a real reading and is usually 0, which is what a passing check expects. Observed: a program that exited 3 reported `exit=0` this way, while the exit code of the `cmd` process itself was 3.

## WRONG
```bash
cmd.exe //c "godot --headless -s res://check.gd & echo exit=%ERRORLEVEL%"   # prints exit=0
```

## RIGHT
```bash
cmd.exe //c "godot --headless -s res://check.gd"; echo "exit=$?"   # read the process's exit code: 3
```

```bat
rem or enable delayed expansion so the value is read at execution time
cmd /v:on /c "godot --headless -s res://check.gd & echo exit=!ERRORLEVEL!"
```

## NOTES
- The same parse-time expansion applies inside parenthesised blocks (`if (...)`, `for ... do (...)`) in .cmd files. Use `!ERRORLEVEL!` with `setlocal EnableDelayedExpansion`, or `if errorlevel 1`.
- Separate lines in a .cmd file are parsed one at a time, so `%ERRORLEVEL%` on the next line is correct.
