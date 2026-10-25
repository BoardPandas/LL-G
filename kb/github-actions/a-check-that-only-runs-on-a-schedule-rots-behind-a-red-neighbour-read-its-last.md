---
tech: github-actions
tags: [ci, scheduled, cron, guards, visual-regression, silent-skip, rot]
severity: high
---
# A check that only runs on a schedule rots behind a red neighbour: read its last RUN, not the workflow file

## PROBLEM

A check wired into a workflow that runs **on a schedule** rather than on push has no
author waiting on it. Nothing attributes its result to a person, nobody opens the run,
and a red run looks the same on day four as on day one.

Two failures then compound, and each hides the other:

1. **An earlier step in the same job fails, so your step never starts.** A job stops at
   the first failing step. The run is red "for the baseline check" (or whatever runs
   first), and that failure may belong to a completely different surface and a
   different author. Your step is reported as skipped, which reads as benign.
2. **Meanwhile the check's own code rots.** It drives a UI, a CLI or an API that keeps
   changing underneath it. Because it never executes, nothing reports that it no longer
   even starts. By the time anyone runs it, it fails on its first assertion against
   markup that was deleted releases ago.

The result is a guard everyone believes is protecting a surface, that has not executed
in days or weeks and could not pass if it did. Measured on one repo: a visual check for
a page rebuilt two releases earlier still drove the removed tab strip and died
immediately; four consecutive scheduled runs were red at an earlier step belonging to
someone else's work, so it had never run since the rebuild. Rewritten against the
current page, it found four real bugs on its first green run, including a CSS class the
UI had been applying for three releases with no rule behind it.

The dangerous part is not the red run. It is that "we have a check for that" stays true
as a sentence and false as a fact.

## WRONG

```yaml
# .github/workflows/visual-cascade.yml
on:
  schedule: [{ cron: "5 10,22 * * *" }]   # nobody is waiting on this
jobs:
  cascade:
    steps:
      - run: pnpm run visual:cascade      # <-- red for days, unrelated surface
      - run: pnpm run visual:my-feature   # never starts; reported as skipped
```

```bash
# And the reasoning that goes with it:
grep -r "visual:my-feature" .github/workflows/   # it's wired!
# => concluding "this page is covered" from the workflow file is the mistake
```

## RIGHT

```bash
# 1. Judge a check by its last RUN, not by its presence in a workflow.
gh run list --workflow=visual-cascade.yml --limit 5 \
  --json databaseId,conclusion,createdAt
# Four failures in a row is the signal, whatever the step names say.

# 2. Find out WHICH step failed. A failure in an earlier step means your step
#    produced no result at all -- that is different from "it passed".
gh run view <id> --json jobs \
  --jq '.jobs[].steps[] | select(.conclusion != "success" and .conclusion != "skipped") | .name'

# 3. Before trusting any guard you have not personally watched run, run it locally.
pnpm run visual:my-feature     # the honest answer in one command
```

```yaml
# 4. Harden the workflow so one surface cannot hide another.
jobs:
  cascade:
    steps:
      - run: pnpm run visual:cascade
        continue-on-error: true          # record it, do not stop the job
      - run: pnpm run visual:my-feature
        if: always()                     # independent surfaces run independently
```

## NOTES

- A check that cannot run is indistinguishable from one that passes. Both produce no
  failure, and only one of them is evidence.
- Scheduled workflows deserve a louder failure path than push workflows, not a quieter
  one, precisely because no author is attached to the result. Route them to wherever
  someone will actually read them.
- `kb/github-actions/red-verify-skips-suite-and-deploy.md` is the push-time sibling:
  there a first-step failure means a landed commit was never tested or deployed. This
  entry is the slower version, where the thing lost is not one deploy but the guard
  itself, over weeks.
- When you do revive such a check, expect it to find real defects immediately, and
  budget for that rather than treating them as new breakage. They accumulated while it
  was blind.
- Independent surfaces belong in independent jobs or steps that cannot mask each other.
  If splitting is too costly, at minimum make the per-step result visible in the run
  summary so "skipped" is not mistaken for "fine".
