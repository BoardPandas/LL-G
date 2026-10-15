---
tech: jest
tags: [test-selection, worktrees, regex, runtestsbypath, scope]
severity: medium
---
# Jest path filters also match worktree directory names

## PROBLEM
Jest path patterns match the full test path, including the checkout directory.
In a worktree named `project-web-push`, a filter containing `web-push` selects
every discovered test, even when only notification tests were intended.
The command looks scoped and accepts the option without warning. It can run
unrelated integration suites with different fixture requirements, producing
misleading failures and excessive runtime or memory use.

## WRONG
```bash
# cwd: /worktrees/project-web-push
pnpm exec jest --testPathPatterns='(web-push|notification)'
# Also matches /worktrees/project-web-push/src/__tests__/billing.test.ts
```

## RIGHT
```bash
# Preview exact discovery, then execute only the named files.
pnpm exec jest --listTests --runTestsByPath \
  src/__tests__/services/web-push-worker.test.ts \
  src/__tests__/services/web-push-contracts.test.ts
pnpm exec jest --runInBand --runTestsByPath \
  src/__tests__/services/web-push-worker.test.ts \
  src/__tests__/services/web-push-contracts.test.ts
```

## NOTES
- Quoting the regex protects it from the shell; it does not constrain Jest to
  basenames or paths relative to the checkout.
- If a pattern is necessary, anchor it to the intended source-directory segment
  and filename suffix, and inspect `--listTests` before running it.
- Keep focused-test results separate from unrelated fixture/environment failures.
- Related: [[run-tests-by-path-for-nextjs-app-router-test-paths]]. That entry
  covers parentheses and brackets being interpreted as regex syntax; this one
  concerns unintended matches in parent directories.
- No repository guard is appropriate: this is an invocation and path-selection
  gotcha, not a project-configuration defect.
