---
tech: claude-code
tags: [bulk-edit, string-replace, scripted-refactor, agents, referenceerror, line-anchored]
severity: medium
---
# Scripted bulk edits: replace(old, new, 1) hits the first occurrence, not the one you meant

## PROBLEM

When an agent fixes N lint findings across a file, the obvious move is a small script per finding: read the file, `replace(old, new, 1)`, write it back. The failure is that the diagnostic names a **line**, but string replacement finds the **first textual match** -- and in real code the same fragment usually appears more than once, with the call site above the declaration.

So the edit silently lands somewhere else. Both halves of the damage are invisible:

- The intended line is left unfixed, so the linter still reports it -- easy to misread as "my fix did not apply."
- Some *other* line was rewritten, usually a caller, where the substitution is nonsense.

Two real cases in one pass:

1. Marking an unused parameter: the target was the signature `async function runConfirm(panel, state, { slug, deckName, onDone, close })` at line 140. The first match of `{ slug, deckName, onDone, close }` was the **call site** at line 79, which became `runConfirm(panel, state, { slug, deckName: _deckName, onDone, close })` -- `_deckName` is not defined in that scope. Instant `ReferenceError` on click, and the callee now receives `deckName: undefined`.
2. Dropping an unused destructured binding: the target was `applyRename` at line 50. The identical line existed in `startRename` at line 10, which *does* call `paint()` and forwards it. Removing `paint` there produced another `ReferenceError`.

Neither was caught by the test suite (that directory had no coverage). Both were caught only because the linter re-reported the *same two* findings afterward -- the "my fix did not apply" symptom was the tell.

## WRONG

```python
def sub(path, old, new):
    s = open(path).read()
    assert old in s, f"NOT FOUND {path}"     # proves it exists SOMEWHERE
    open(path, 'w').write(s.replace(old, new, 1))   # ...rewrites the FIRST one

# Diagnostic said confirm-sheet.js:140. This edits line 79.
sub('confirm-sheet.js',
    '{ slug, deckName, onDone, close }',
    '{ slug, deckName: _deckName, onDone, close }')
```

## RIGHT

```python
# Anchor on the line number the diagnostic gave, and assert the line's
# CONTENT before writing. A wrong target then fails loudly instead of
# corrupting a caller.
def sub_line(path, lineno, old, new, expect_startswith=None):
    L = open(path).read().split('\n')
    i = lineno - 1                                  # diagnostics are 1-indexed
    if expect_startswith:
        assert L[i].lstrip().startswith(expect_startswith), f"{path}:{lineno} is {L[i]!r}"
    assert old in L[i], f"{path}:{lineno} lacks {old!r}: {L[i]!r}"
    L[i] = L[i].replace(old, new)
    open(path, 'w').write('\n'.join(L))

sub_line('confirm-sheet.js', 140,
         '{ slug, deckName, onDone, close }',
         '{ slug, deckName: _deckName, onDone, close }',
         expect_startswith='async function runConfirm')
```

```bash
# Before removing a destructured binding, prove it is unused in ITS function,
# not just in the file -- the same destructure line often appears in a sibling
# that does use it.
awk 'NR>=49 && NR<=110' slot-drawer-actions-rename.js | grep -n 'paint'
```

## NOTES

- The `assert old in s` guard feels safe but only proves the fragment exists somewhere; it does nothing about *which* occurrence gets rewritten. It is what makes this failure feel verified.
- `grep -n '<fragment>' <file>` before every scripted edit shows the occurrence count immediately. More than one hit means do not use plain replace.
- Prefer a real edit tool that requires a unique match (and errors on ambiguity) over hand-rolled replace when one is available.
- Re-run the linter after a bulk pass and compare the finding list to the one you started from. A finding that persists unchanged means the edit landed elsewhere -- treat it as a corruption signal, not a no-op.
- After any scripted edit to browser JS, run a scope check that catches this class: `biome check --only=correctness/noUndeclaredVariables <dir>` (see the typescript entry on excluded directories -- tests and tsc may cover none of it).
