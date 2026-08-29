---
tech: claude-code
tags: [doc-sync, documentation, incremental, checkpoint, base-commit, git, metadata, skills]
severity: high
---
# An incremental doc run's base commit is a claim, and the file the skill tells you to read is the one that goes stale

## PROBLEM

`/doc-sync` in update mode diffs `base_commit..HEAD` to decide which pages to
regenerate. The skill says to read that base from `docs/_meta/GENERATION.md`.
But the base is recorded in **two** places -- `_meta/GENERATION.md` and the
`ref_commit_hash` in `_toc.yaml` -- and a run that updates the TOC but dies,
is interrupted, or simply forgets to rewrite `GENERATION.md` leaves them
disagreeing with nothing to flag it.

Measured: `GENERATION.md` said `823e7157` (2026-07-17) while `_toc.yaml` said
`5cad6bdf` (2026-08-20). **576 commits apart.** Nothing errors. Both files
parse. Both look authoritative.

The failure is asymmetric, and only one direction announces itself:

- **Base too OLD** (what happened): the run sees 633 commits / 2147 files,
  concludes every page is affected, and regenerates six weeks of already-correct
  work. Expensive and it silently overwrites hand-written corrections inside
  AUTOGEN blocks -- but at least the volume is visible.
- **Base too NEW** (the dangerous one): pages that genuinely needed updating
  fall outside the diff, are never regenerated, and the run reports success with
  a clean validation pass. The docs stay wrong and the summary says they are
  current. **This is silent wrong output.**

Neither field is trustworthy on its own, and "use the newer one" is not the fix
either -- the newer value is exactly what a too-new base looks like.

## WRONG

```bash
# Trust the metadata file the skill points at, because it is the one documented.
BASE=$(grep -oP 'Base commit:.*`\K[0-9a-f]{40}' docs/_meta/GENERATION.md)
git diff --name-only "$BASE"..HEAD
# 2147 files. Regenerate "everything affected" -- six weeks of correct pages
# rewritten, hand-edits inside AUTOGEN blocks lost, and no signal anything
# was off.
```

## RIGHT

```bash
# 1. Read BOTH records and make a disagreement loud.
META=$(grep -oP 'Base commit:.*`\K[0-9a-f]{40}' docs/_meta/GENERATION.md)
TOC=$(grep -oP 'ref_commit_hash:\s*"\K[0-9a-f]{40}' docs/_toc.yaml)
[ "$META" = "$TOC" ] || echo "BASE DISAGREEMENT: meta=$META toc=$TOC"

# 2. Settle it with evidence from the PAGES, not from either field. Pick a
#    feature that landed between the two candidates and ask whether the docs
#    already know about it.
git log -1 --format=%cs -- dashboard/src/lib/playmat-store-crud.ts   # 2026-08-28
grep -ril playmat docs/                                             # -> nothing
git log -1 --format=%cs -- dashboard/src/lib/personas.ts            # 2026-08-05
grep -ril persona docs/                                             # -> 7 files
# Pages know about personas (after $META) but not playmats (after $TOC),
# so $TOC is the real base. $META was simply never rewritten.

# 3. Sanity-check the size before committing to it.
git rev-list --count "$TOC"..HEAD   # 57 commits, not 633

# 4. Rewrite BOTH records, and record which was wrong and how you knew --
#    the next run inherits your conclusion, not your reasoning.
```

## NOTES

- The evidence test only works one way round: a page mentioning a feature proves
  the base is at or after that feature. A page NOT mentioning something proves
  nothing on its own (it may simply be uncovered), so pick a feature you know is
  documented once covered, and test a pair that straddles both candidates.
- Same shape wherever a generator checkpoints itself into a file it also
  rewrites: price/rating snapshotters, sync high-water marks, migration
  trackers. Two writes that must both land, with no transaction and no
  reconciliation, is the whole bug.
- Cheap structural fix: have the run write the base to ONE place and derive the
  other, or assert equality at startup and refuse. A disagreement is always a
  bug in the previous run, never a legitimate state.
- The "regenerate everything" direction is also how hand-written pages get
  clobbered. A tombstone page for a removed feature (no AUTOGEN markers, kept
  deliberately) looks exactly like a page with zero remaining sections; verify
  before archiving or rewriting one.
- Related: [A concurrent session can move the branch under you](concurrent-session-moves-branch.md)
  -- if a doc run and another session share a working tree, HEAD can move
  mid-run, so capture the target commit once at the start and cite against that.
