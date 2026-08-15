---
tech: github-actions
tags: [ci, verify, deploy, guards, shared-trunk, silent-skip, line-cap]
severity: high
---
# A guard that fails FIRST in `verify` skips every later step and the deploy, so "it's on main" means neither tested nor shipped

## PROBLEM

The standard `verify` -> `deploy` workflow puts cheap guards first (line-cap, lint,
undeclared-variable checks) and the expensive work after (install, build, typecheck,
test, coverage). `deploy` is gated on `needs: verify`.

When the FIRST guard fails, two things happen and neither announces itself:

1. **Every later step in `verify` is skipped.** The build never ran. The typecheck
   never ran. `Test all packages` never ran. The commit has NO CI verification of
   any kind -- but the run's failure is attributed to the guard, so the summary reads
   "line-cap FAILED" and nothing says "and 2,800 tests were never executed."
2. **`deploy` is skipped silently.** GitHub reports it as `0s` / skipped, not as an
   error. `main` shows the commit. `git log` shows it landed. Production is still
   serving the previous release, and nothing on the repo page says so.

The combination is what makes this HIGH rather than an ordinary red build: the commit
LOOKS landed, verified and deployed, and all three are false at once.

**It is contagious across authors on a shared trunk.** The next person pushes an
unrelated commit; their run fails on YOUR file, at the same first guard. Their code is
now also unverified and undeployed, and the failure names a file they never touched.
Measured: two commits from two authors sat on `main` for ~15 minutes with zero CI
verification and a stale production, because one file was 7 lines over a 500-line cap.

The trap that produces it is ordinary: you run the guard suite, THEN write more code,
then push. The guards you ran do not cover the code you added afterwards.

## WRONG

```yaml
# .github/workflows/ci.yml
jobs:
  verify:
    steps:
      - run: pnpm run check:linecap      # <-- fails here
      - run: pnpm install                # never runs
      - run: pnpm run build:all          # never runs
      - run: pnpm run typecheck:all      # never runs
      - run: pnpm run test:all           # never runs  <-- the suite is NOT a gate
  deploy:
    needs: verify                        # skipped, reported as 0s, no error
```

```bash
# And the local habit that feeds it:
pnpm run check:guards        # green
# ...now add the feature code that pushes a file over the cap...
git commit -m "..." && git push        # pushed on a stale guard result

git log --oneline origin/main -1       # your commit is there
# => concluding "landed" from this is the actual mistake
```

## RIGHT

```bash
# 1. Re-run the guards AFTER the last edit, not before it. A guard result is only
#    evidence about the tree that existed when it ran.
pnpm run check:guards && git push origin main

# 2. Never infer deployment from `git log`. Watch the run to its terminal state --
#    --exit-status makes a skipped deploy a non-zero exit rather than a quiet 0s.
gh run watch "$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')' \
  --exit-status

# 3. When a run fails, read WHICH step failed before trusting anything after it.
gh run view <id> --log-failed | head -20
# A first-step failure means the suite never ran: the commit is unverified, not
# merely un-deployed.

# 4. Then confirm the artifact is actually live, from outside the repo.
curl -s -o /dev/null -w '%{http_code}\n' https://<prod-host>/<asset-added-by-this-commit>
```

```yaml
# Optional workflow hardening: make "skipped deploy" visible instead of silent.
  deploy:
    needs: verify
    steps: [...]
  report-not-deployed:
    needs: [verify, deploy]
    if: always() && needs.deploy.result == 'skipped'
    steps:
      - run: |
          echo "::warning::verify failed -- production was NOT updated and the
          test suite may never have run. HEAD of main is not what is deployed."
```

## NOTES

- Ordering cheap-guards-first is still correct; it saves CI minutes. The defect is
  reading a failed run as "the guard caught something" when it also means "nothing
  after this point was checked."
- Related, same repo family: `kb/git/concurrent-shared-tree-worktree.md` and
  `kb/git/interrupted-rebase-detaches-head.md` -- both are cases of a git/CI signal
  reading as success while the real state differs. This one is the CI-side member.
- Corollary for the fixer: when you break the trunk this way, you are also holding
  everyone else's deploys. Splitting the oversized file is more urgent than it looks
  from the size of the diff.
- The `workflow_run`-gating trap in
  `kb/github-actions/release-workflow-not-gated-on-ci.md` is the mirror image: there a
  release ships on a red commit; here a green-looking commit ships nothing at all.
