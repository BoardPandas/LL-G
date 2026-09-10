---
tech: git
tags: [gitattributes, line-endings, crlf, autocrlf, eol, normalization, diff-noise, generated-files]
severity: high
---
# A CRLF checkout plus an LF-only rewrite turns every CR into a blank line, and the file doubles every cycle

## PROBLEM

Two individually-reasonable behaviours compose into unbounded growth:

1. A Windows clone with `core.autocrlf=true` (the Git for Windows install default) writes
   CRLF into the working tree.
2. Some tool later rewrites that file with LF endings. Tools that treat a lone `\r` as a
   line terminator -- the classic-Mac convention, still honoured by many line splitters --
   emit one line per CR, so every CR becomes a **real blank line** in the committed content.

Each pass roughly doubles the line count, and the next Windows write re-adds one CR per
line, arming the next doubling. Measured on LL-G's own master `llms.txt`:

| stage | CRs | LFs | blank lines | content lines |
|---|---|---|---|---|
| before | 511 | 257 | 86 | 171 |
| +1 cycle | 0 | 768 | 597 | 171 |
| +2 cycles | 0 | 1534 | 1363 | 171 |
| +3 cycles | 0 | 3071 | 2898 | 173 |

257 -> 768 -> 1537 -> 3071 lines while the actual content never left ~173. The arithmetic
identifies the mechanism: 768 = 257 + 511, the new line count is exactly old lines plus
old CRs.

Everything about it looks healthy. `git status` is clean, the content is all present and
correctly ordered, and Markdown renders N blank lines identically to one, so no consumer
ever complains. The only tell is the diff: changing a single number in that file produced
**768 insertions and 257 deletions**, which destroys `git blame` and `git log -p` for the
file and turns every concurrent edit into a conflict.

A `.gitattributes` that covers only shell scripts does not help, and its presence reads as
though line endings are already a solved problem in the repo.

## WRONG

```gitattributes
# Only .sh is protected. Every other text file is still subject to the cycle, and
# this file existing suggests line endings have already been dealt with.
*.sh text eol=lf
```

```python
# The "obvious" repair, which re-runs the damage it is cleaning up:
#   b'line\r\r\n'
#     .replace(b'\r\n', b'\n')  -> b'line\r\n'
#     .replace(b'\r',   b'\n')  -> b'line\n\n'
# One CR became one blank line. You have just performed another cycle by hand.
raw.replace(b'\r\n', b'\n').replace(b'\r', b'\n')
```

## RIGHT

```gitattributes
# text=auto alone normalizes what is COMMITTED. eol=lf is the half that matters,
# because it pins the CHECKOUT, so core.autocrlf=true cannot write the CRs back in.
* text=auto eol=lf

*.sh text eol=lf
```

```python
# Repair: DELETE the CRs. Never translate them to newlines.
# Safe only when the file also contains LFs -- see NOTES.
raw.replace(b'\r', b'')
```

```bash
# Then renormalize the index, and collapse the blank runs an earlier cycle already
# committed (the attribute stops new damage; it does not undo old damage).
git add --renormalize .
```

## NOTES

- **`.gitattributes` governs git clients, not API writes.** A write through the GitHub
  contents API (`PUT /repos/:owner/:repo/contents/:path`) stores the bytes you send
  verbatim -- no clean filter runs -- so `eol=lf` cannot stop CRs entering that way.
  Observed the day after the attribute was added to this repo: a knowledge-base helper
  base64-encoded a Windows-written scratch file and put 24 CRs straight into a shelf
  index, and only the CI check caught it. Normalize inside whatever tool performs the
  API write (`tr -d '\r' < file | base64`), because the repo's own rules do not apply
  on that path.
- Verify with bytes, not appearance: `tr -cd '\r' < f | wc -c` and
  `grep -c '^[[:space:]]*$' f`. Any file whose blank lines outnumber its content lines has
  been through at least one cycle.
- Deleting CRs is only safe when the file also contains LFs. A classic-Mac CR-only file
  (CRs, zero LFs) would collapse into a single line, so assert `b'\n' in raw` first.
- Guard it in CI rather than trusting the attribute to stay: assert that no tracked text
  file contains a CR and that no file has a run of 2+ consecutive blank lines. Both are
  one-liners, both fail loudly, and both catch the attribute being deleted later.
- This bites any generated or tool-maintained file that round-trips through a Windows
  editor -- indexes, lockfiles, ORM snapshots, changelogs -- not just documentation.
- A line-count budget will not catch the cost, because the growth is in bytes the line
  count does not explain. See `kb/claude-code/line-budgets-gamed-by-long-lines.md`.
