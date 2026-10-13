---
tech: github-actions
tags: [github-actions, rerun, re-run-failed-jobs, outputs, freshness, deploy, stale]
severity: high
---
# Re-run failed jobs reuses earlier jobs' outputs, so a freshness check in an earlier job goes stale

## PROBLEM
A gate job computes "this commit is still `main`'s tip" and exposes it as a job output. On an old failed deploy, "Re-run failed jobs" re-executes only the failed jobs. Successful jobs are not re-run, so the gate's output from the original attempt is reused as-is. If `main` has moved on since, the stale "is tip: true" lets the deploy job ship an older commit over a newer release. The check was correct when it ran and is wrong now.

## WRONG
```yaml
jobs:
  gate:
    outputs: { is_tip: "${{ steps.check.outputs.is_tip }}" }
    steps:
      - id: check
        run: |
          tip=$(gh api repos/$REPO/commits/main --jq .sha)
          echo "is_tip=$([ "$tip" = "$HEAD_SHA" ] && echo true || echo false)" >> "$GITHUB_OUTPUT"
  deploy:
    needs: gate
    if: needs.gate.outputs.is_tip == 'true'
    steps: [ { run: "pnpm run deploy" } ]
```

## RIGHT
```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Refuse to deploy a superseded commit
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
          HEAD_SHA: ${{ github.event.workflow_run.head_sha }}
        run: |
          tip=$(gh api "repos/$REPO/git/ref/heads/main" --jq .object.sha)
          if [ "$tip" != "$HEAD_SHA" ]; then
            echo "::error::$HEAD_SHA is no longer main's tip ($tip); refusing to deploy"
            exit 1
          fi
      - run: pnpm run deploy
```

## NOTES
Repeat the check as the first step of the job that deploys, so it runs again on every attempt. Query `git/ref/heads/main`, not `commits/main`: `commits/main` is ambiguous when a tag named `main` also exists, and it can resolve to the tag. Keep the gate job if it is useful for skipping work, but never rely on its output alone for a safety decision.
