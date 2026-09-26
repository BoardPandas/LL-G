---
tech: railway
tags: [railway, github-actions, wait-for-ci, checkSuites, deploy-verification, deadlock, release-branch, ci]
severity: high
---
# "Wait for CI" deadlocks a CI job that waits for the deploy, and Railway then skips the deploy

## PROBLEM

A job that confirms production is serving the pushed commit (poll a version
endpoint until it reports `$GITHUB_SHA`) is a natural last step in CI. On Railway
it is a deadlock whenever the service has **Wait for CI** on:

1. Railway sees the push to its tracked branch and holds the deploy until every
   GitHub check suite on that commit has completed and passed.
2. The verify job is part of the CI workflow's check suite, so that suite stays
   in progress while the job runs.
3. The job is waiting for a deploy that Railway will not start until the suite
   finishes. Neither side moves.
4. The job times out, the suite concludes `failure`, and Railway **skips** the
   deploy it was holding.

The result is not one bad deploy. Every push from then on is held and skipped the
same way, so production silently stops receiving changes while each CI run reads
as "the verify job is flaky". Nothing in the repo shows the setting: it lives only
in the Railway dashboard, and the API cannot reliably set it (see
[service-source-write-reports-applied.md](service-source-write-reports-applied.md)),
so the person adding the job has no local signal that it exists.

The obvious workaround does not remove the race. Moving the check to a separate
workflow triggered by `workflow_run` on CI completion creates a *new* check suite,
attached to the default-branch head, which is usually the same SHA Railway is
holding. Whether Railway evaluates before or after that suite appears is timing.

## WRONG

```yaml
# ci.yml, with Railway "Wait for CI" ON for the service
jobs:
  deploy:            # moves the branch Railway tracks, after every gate passes
    needs: [lint, test, build]
    steps:
      - run: git push origin "$GITHUB_SHA":refs/heads/release

  verify-deploy:     # same workflow, same check suite: Railway waits for it,
    needs: deploy    # it waits for Railway, both stop, then Railway skips
    steps:
      - run: node scripts/verify-deploy.mjs   # polls /version until it reports GITHUB_SHA
```

## RIGHT

```yaml
# Railway "Wait for CI" OFF on every service. Gating already happens by ref:
# the `deploy` job only moves `release` after the gates pass, so the setting
# adds nothing. Say so next to the job, because the dashboard is the only
# place the setting is visible.
jobs:
  verify-deploy:
    # REQUIRES Railway "Wait for CI" OFF on every service. With it on, Railway
    # holds the deploy for this job, this job holds the workflow for the deploy,
    # and after the timeout the failed run makes Railway skip the deploy.
    needs: deploy
    timeout-minutes: 25
    steps:
      - run: node scripts/verify-deploy.mjs
```

Before the first push that adds such a job, check every service in the dashboard:
**Service -> Settings -> Source -> "Wait for CI"**.

## NOTES

- **Not observed in production.** This was caught before shipping, by reasoning
  from Railway's documented Wait for CI behaviour, and the toggle was confirmed
  off on all five services before the job went live. The job then passed on its
  first run (SupportForge, 2026-09-26: promoted at 04:49:18, deploy confirmed at
  04:51:18).
- **A service that also has Wait for CI on but is not the one being polled** does
  not deadlock. It deploys late, after the verify job finishes, and is skipped if
  that job fails.
- **Reading the setting through the API:** in Railway's public GraphQL schema the
  flag is `checkSuites` on `DeploymentTrigger` (also on its create and update
  inputs), not on `ServiceInstance.source`, which only has `image` and `repo`.
- **Railway exposes `RAILWAY_GIT_COMMIT_SHA` at runtime** for deploys triggered by
  a push to the tracked GitHub branch, not only at build time. The docs say only
  that git variables exist "if the deploy originated from a GitHub trigger". An
  app can therefore report its exact deployed commit, and a verify job can match
  on it instead of on a version string. Keep a fallback for deploys Railway starts
  some other way, such as a variable-change redeploy: match the version, and
  require that the process started after the check began, so that an old build
  sharing the version (a push with no bump) cannot pass.
- **Accept a descendant commit as live.** A second push that lands before the
  first deploys replaces it, and the served commit then contains the first one.
  Matching only on equality turns the first push's check red for no reason.
- Related: [red-verify-skips-suite-and-deploy.md](../github-actions/red-verify-skips-suite-and-deploy.md)
  (a red gate silently skips the deploy job).
