---
tech: godot
tags: [gut, testing, headless, ci, exit-code, gdscript, static-typing]
severity: high
---
# GUT skips a test file that fails to compile and still prints "All tests passed!" with exit 0

## PROBLEM
When a GUT test script fails to compile (a parse error, a strict-typing warning treated as error, or a missing dependency), GUT 9.7.1 on Godot 4.7.2 logs it as `[GUT WARNING]: Ignoring script ... because it does not extend GutTest`, runs the remaining scripts, prints `---- All tests passed! ----` and exits 0.
It is not obvious because every signal CI usually reads says green. A typo or a stricter project setting silently deletes that file's tests, and the totals just show fewer scripts. Verified: an untyped test file under `untyped_declaration = error` produced 6 `SCRIPT ERROR` lines and a `Failed to load script` ERROR, yet the run reported `All tests passed!` with exit code 0. In the same run a second test file was skipped the same way because a class it used was missing, so the count dropped from 13 tests to 5 with no failure.

## WRONG
```bash
# CI trusts GUT's exit code
godot --headless --path game -s addons/gut/gut_cmdln.gd || exit 1
```

## RIGHT
```bash
out=$(timeout 300 godot --headless --path game -s addons/gut/gut_cmdln.gd 2>&1); rc=$?
printf '%s\n' "$out"
[ "$rc" -eq 0 ] || exit 1
# A script GUT could not load is a failure, whatever the exit code says
if printf '%s\n' "$out" | grep -qE 'SCRIPT ERROR|^ERROR:|Ignoring script'; then exit 1; fi
# Guard against a run that tested nothing
printf '%s\n' "$out" | sed 's/\x1b\[[0-9;]*m//g' | grep -qE '^Tests +[1-9]' || exit 1
```

## NOTES
- GUT's output contains ANSI colour codes; strip them before matching the totals.
- A headless `-s` run that errors before `quit()` never exits, so give every Godot run a timeout.
- Loading every script separately (a smoke script that calls `ResourceLoader.load()` on each `.gd` and checks `can_instantiate()`) catches the broken file independently of GUT.
- Related: `godot/powershell-does-not-wait-for-godot-s-windowed-exe-on-windows-so-a-headless-check` (a different way a Godot check reports success while testing nothing).
