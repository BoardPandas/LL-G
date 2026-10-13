---
tech: github-actions
tags: [github-actions, concurrency, workflow_run, deploy, cancel-in-progress, gate]
severity: high
---
# Workflow-level concurrency lets a superseded workflow_run displace the tip's pending deploy

## PROBLEM
GitHub keeps one pending run per concurrency group and cancels any older pending run when a newer one arrives. A deploy workflow triggered by `workflow_run` often has a gate job that skips any run whose commit is no longer `main`'s tip. Put `concurrency` at the workflow level and the skipped runs still join the group, so they can cancel the run that matters:

1. Run X (commit A) is deploying.
2. Commit B (the tip) finishes CI and its deploy run becomes pending.
3. A late `workflow_run` for commit A arrives and becomes pending too.
4. GitHub cancels B's pending run to make room for A.
5. A's gate sees it is not the tip and skips. Nothing deploys the tip, and every run is green.

## WRONG
```yaml
name: deploy
on:
  workflow_run: { workflows: [CI], types: [completed], branches: [main] }
concurrency:
  group: deploy
  cancel-in-progress: false
jobs:
  gate:
    runs-on: ubuntu-latest
    outputs: { is_tip: "${{ steps.check.outputs.is_tip }}" }
    steps: [ { id: check, run: "..." } ]
  deploy:
    needs: gate
    if: needs.gate.outputs.is_tip == 'true'
    runs-on: ubuntu-latest
    steps: [ { run: "pnpm run deploy" } ]
```

## RIGHT
```yaml
jobs:
  gate:
    runs-on: ubuntu-latest
    outputs: { is_tip: "${{ steps.check.outputs.is_tip }}" }
    steps: [ { id: check, run: "..." } ]
  deploy:
    needs: gate
    if: needs.gate.outputs.is_tip == 'true'
    runs-on: ubuntu-latest
    concurrency:
      group: deploy
      cancel-in-progress: false
    steps: [ { run: "pnpm run deploy" } ]
```

## NOTES
Skipped jobs never enter a job-level concurrency group, so a superseded run cannot displace the tip. `cancel-in-progress: false` keeps an in-flight deploy from being killed mid-rollout. Pair this with the freshness check in the deploy job itself (see the re-run entry), because the gate's output can be stale.
