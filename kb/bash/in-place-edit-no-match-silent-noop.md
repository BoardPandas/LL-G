---
tech: bash
tags: [sed, python, in-place-edit, silent-failure, versioning, scripted-edits, ci]
severity: high
---
# An in-place edit whose anchor does not match changes nothing and exits 0

## PROBLEM

Every common way to patch a file in place treats "the anchor was not found" as
success, not as an error:

- `sed -i 's/old/new/' f` exits **0** and leaves the file byte-identical.
- Python `s.replace(old, new)` returns the **original string** unchanged.
- `perl -pi -e 's/old/new/'` behaves like sed.

So a scripted edit that silently did nothing is indistinguishable from one that
worked, and the next command in the `&&` chain runs happily.

This compounds viciously when the anchor is derived from the value you are
replacing. A version bump written as
`sed -i 's/"version": "1.2.3"/"version": "1.2.4"/' package.json` is correct
exactly once. If it ever no-ops, the file keeps the *old* value, and every later
bump anchors on a version the file never reached — so the first failure silently
disables all subsequent ones.

It gets worse when a paired file is written with a method that cannot fail.
`echo "1.2.4" > VERSION` always succeeds. Pair it with a `sed` on `package.json`
and the two drift apart without a single error:

```
commit A   VERSION=1.2.3   package.json=1.2.3   ok
commit B   VERSION=1.2.4   package.json=1.2.3   <- sed no-op, nobody notices
commit C   VERSION=1.3.0   package.json=1.2.3   <- anchors on 1.2.4, never matches
commit D   VERSION=1.4.0   package.json=1.2.3
```

In the case this came from, `package.json` sat four releases behind while
`VERSION` and the changelog advanced. The build baked its public version string
from `package.json`, so the deployed app reported an older build than it was —
to the very mechanism that tells a stale browser tab a new deploy is live.

## WRONG

```bash
# Exits 0 whether or not it matched. Nothing downstream can tell.
sed -i 's/"version": "1.2.3"/"version": "1.2.4"/' package.json
echo "1.2.4" > VERSION          # this one always works, so the two drift
git add -A && git commit -m "Release 1.2.4"
```

```python
# str.replace returns the original when the anchor is absent. No exception.
s = open("CHANGELOG.md").read()
s = s.replace("## [1.2.3]", "## [1.2.4]\n\n- new stuff\n\n## [1.2.3]")
open("CHANGELOG.md", "w").write(s)   # may have written back the input verbatim
```

## RIGHT

```bash
# Assert the file actually changed. cmp is cheap and exact.
cp package.json /tmp/pkg.before
sed -i 's/"version": "[^"]*"/"version": "1.2.4"/' package.json
cmp -s /tmp/pkg.before package.json && { echo "sed matched nothing" >&2; exit 1; }
```

```python
# Anchor on a pattern that does not embed the old value, and assert the write.
import re, sys
s = open("package.json").read()
s2, n = re.subn(r'("version"\s*:\s*")[^"]+(")', r'\g<1>1.2.4\g<2>', s, count=1)
if n != 1:
    sys.exit("version key not found in package.json")
open("package.json", "w").write(s2)
```

```bash
# And verify the invariant, not just the edit, before you ship:
v=$(tr -d ' \n' < VERSION)
p=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -1)
[ "$v" = "$p" ] || { echo "VERSION ($v) != package.json ($p)" >&2; exit 1; }
```

## NOTES

- Anchor on the **shape** of the thing (`"version"\s*:\s*"[^"]*"`), never on the
  value you are replacing. A shape anchor cannot go stale.
- Prefer a tool that fails loudly. `python -c 'json.dump(...)'` with a `KeyError`,
  or `jq '.version = "1.2.4"'`, beats a regex that shrugs.
- The cheapest durable guard is a CI assertion on the *invariant* rather than the
  edit: "these two files agree" and "the changelog contains a section for the
  version being shipped". Those catch the no-op no matter which script caused it.
- Related, and a different failure in the same family:
  `kb/claude-code/blind-string-replace-wrong-occurrence.md` covers
  `replace(old, new, 1)` hitting the **wrong** occurrence. This entry is about
  hitting **no** occurrence.
- The guard that should have caught this had its own version of the bug — see
  `kb/claude-code/hook-validates-text-not-state.md`.
