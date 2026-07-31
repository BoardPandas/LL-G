---
tech: bash
tags: [windows, command-v, dependency-probe, python3, git-bash, hooks, silent-failure, fallback, ci]
severity: high
---
# `command -v` finds a Windows Store alias stub that never runs, silently selecting a broken interpreter

## PROBLEM

`command -v foo` answers "does the name `foo` resolve on PATH", not "can I run `foo`". On Windows those differ, and the gap is silent.

Windows ships **app execution alias stubs** in `%LOCALAPPDATA%\Microsoft\WindowsApps\` for `python`, `python3`, and others. The stub is a real file on PATH, so `command -v python3` prints a path and exits 0 even when no Python is installed. Executing it writes

```
Python was not found; run without arguments to install from the Microsoft Store, or disable this shortcut from Settings > Apps > Advanced app settings > App execution aliases.
```

to **stderr** and exits **49**, producing **no stdout**.

The damage is the `elif`. The standard shape is "prefer python3, fall back to jq" -- the presence probe passes, the python3 branch is taken, and the working fallback is never reached even though jq is installed and fine. Every command substitution against that interpreter returns the empty string.

Empty string is the dangerous part, because it is rarely distinguishable from a legitimate result. In a Claude Code hook library this parsed every field of the stdin JSON payload to `""`; every gate then self-filtered on its own empty input and exited 0. A repo's entire enforcement layer -- a Graph API privilege-escalation gate and a PowerShell `#Requires -Modules` gate among them -- silently allowed everything on Windows while looking identical to a working install. Nothing errored, because exit 0 is also what "allowed" looks like.

Two traps make it worse:

1. **`python` and `python3` can disagree.** A real interpreter at `C:\Python314\python` coexists with a stub `python3`. Probing the wrong name reports failure on a machine that has Python.
2. **The test harness has the same bug.** The suite that should have caught this built its JSON fixtures with `python3` and emitted empty payloads, so hooks received empty stdin and exited 0 -- making every `expected exit 0` assertion pass *for the wrong reason*. Blocking assertions failed with a misleading "expected 2, got 0" that pointed at the gates instead of the parser.

## WRONG

```bash
# Presence, not capability. On Windows this selects a stub that exits 49 with
# no stdout, and the working jq fallback below is never reached.
if command -v python3 >/dev/null 2>&1; then
  parse() { printf '%s' "$1" | python3 -c 'import sys,json; print(json.load(sys.stdin)["k"])'; }
elif command -v jq >/dev/null 2>&1; then
  parse() { printf '%s' "$1" | jq -r .k; }
fi

# Also wrong: exit-code-only probe. Catches this particular stub (49), but still
# accepts any interpreter that exits 0 while writing nothing to stdout.
if python3 -c 'pass' >/dev/null 2>&1; then ...
```

## RIGHT

```bash
# Probe the capability you actually consume: a sentinel arriving on STDOUT.
# An interpreter that exits 0 but prints nothing is as useless as a missing one,
# and both must fall through to the next candidate.
_parser_works() { [ "$("$@" 2>/dev/null)" = "probeok" ]; }

if   _parser_works python3 -c 'print("probeok")'; then
  PARSER=python3
elif _parser_works jq -rn '"probeok"'; then
  PARSER=jq
else
  PARSER=""
fi

# Fail CLOSED where an empty parse would mean "allow".
if [ -z "$PARSER" ]; then
  echo "BLOCKED: no working JSON parser (a python3 stub may still be on PATH)" >&2
  exit 2
fi
```

## NOTES

- **Reproduce in one line:** `printf '%s' '{}' | python3 -c 'print("OK")'; echo "exit: $?"` -- a stub prints the Store message and reports `exit: 49` with no `OK`.
- **Generalizes past python3.** Apply the functional probe to any `command -v` gate for an interpreter or CLI (`node`, `php`, `py`, `deno`). Shims, wrappers, `.cmd` shells, and broken symlinks all resolve without running. Prefer a sentinel on stdout over an exit code whenever downstream code consumes stdout.
- **Assert the probe in CI, not just the feature.** Add a test that the selected parser actually extracts a known field from a fixture payload. Reintroducing `command -v` should fail a test named for the parser, so the root cause is named instead of appearing as a cascade of downstream failures. Verify the test has teeth by mutating the probe back and confirming it goes red.
- **Beware equality checks over possibly-empty sets.** A comparison like `[ "$a" = "$b" ]` where both were built by a silently-failing parser reports a confident match while comparing nothing. Guard non-emptiness before trusting equality -- same defect one layer up.
- **MSYS/Git Bash argument rewriting** is a separate trap in the same territory: a leading-slash argument such as `/tmp/x` is rewritten to `C:/Users/<you>/AppData/Local/Temp/x` before a native binary (`jq.exe`, `python.exe`) sees it, so exact round-trip comparisons fail on Windows for reasons unrelated to the code under test. Use relative paths in fixtures. See [git-bash-windows.md](git-bash-windows.md).
- Related, same silent-allow shape by a different route: `kb/claude-code/hook-env-vars-do-not-exist.md` (`$TOOL_NAME`/`$TOOL_INPUT` do not exist; hook input is JSON on stdin) and `kb/claude-code/sandboxed-bash-fakes-missing-dependency.md` (presence on disk is not proof a probe works -- verify the capability, not the artifact).
