---
tech: pnpm
tags: [pnpm, pnpm-12, ci, github-actions, verify-deps-before-run, frozen-lockfile, step-ordering]
severity: high
---
# pnpm 12 `pnpm run` installs dependencies itself, so CI steps meant to run "before install" silently do the install

## PROBLEM
pnpm 12 verifies dependencies before every `pnpm run <script>` and, when `node_modules` is
missing or stale, runs an install first (`verifyDepsBeforeRun`). A workflow that deliberately
runs dependency-free guards BEFORE `pnpm install --frozen-lockfile` (to fail fast, or to keep
guard results independent of the install) does not get that: the first `pnpm run` step
performs the install inside its own log, and the explicit frozen step afterwards just prints
"Already up to date".

Nothing fails, so nobody notices:
- The guards are no longer independent of the install, which was the point of the ordering.
- The install that actually populated `node_modules` is not the step you wrote and reviewed.
- `pnpm config get verifyDepsBeforeRun` prints `undefined`, so the default is not discoverable.

Found 2026-10-11 on pnpm 12.11.2 by running the pre-install steps in a copy of the repo with
no `node_modules`: `node_modules` existed afterwards.

## WRONG
```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: pnpm/action-setup@<sha> # reads packageManager
      - uses: actions/setup-node@<sha>
        with: { node-version: "24", cache: pnpm }
      # Intended to run before the install. Actually installs.
      - run: pnpm run test:guards
      - run: pnpm install --frozen-lockfile   # now a no-op
```

## RIGHT
```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    env:
      # Only the explicit --frozen-lockfile step may install.
      pnpm_config_verify_deps_before_run: "false"
    steps:
      - uses: pnpm/action-setup@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version: "24", cache: pnpm }
      - run: pnpm run test:guards
      - id: install
        if: ${{ !cancelled() }}
        run: pnpm install --frozen-lockfile
```

Verify locally: copy the repo without `node_modules`, run the step with the env var set, and
confirm no `node_modules` appears.
```bash
rsync -a --exclude node_modules ./ /tmp/sim/ && cd /tmp/sim
pnpm_config_verify_deps_before_run=false pnpm run test:guards
test ! -e node_modules && echo "no implicit install"
```

## NOTES
- The env prefix matters: `pnpm_config_verify_deps_before_run=false` works;
  `npm_config_verify_deps_before_run=false` is ignored and the install still runs.
- Setting it at job level keeps every step's command exactly `pnpm run <name>`, so a guard
  that matches whole `run:` commands (see github-actions/guard-in-check-all-but-not-in-ci)
  still matches. The per-command form is `pnpm --config.verify-deps-before-run=false <script>`,
  flag BEFORE the script name.
- Related: run-verifies-deps-against-workspace-root (the same check installing a whole
  monorepo from a nested package).
