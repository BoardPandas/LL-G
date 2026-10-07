---
tech: github-actions
tags: [ci, guards, check-all, package-scripts, workflow, silent-skip, enforcement, self-test]
severity: high
---
# A guard added to the local `check:all` script never runs in CI when the workflow runs its steps individually

## PROBLEM

Many repos keep an aggregate script for developers (`check:all`, `make check`,
`just ci`) AND a workflow that runs each check as its own named step, for clear
failure attribution and deliberate ordering. The workflow never calls the
aggregate.

Adding a new guard to the aggregate script feels like wiring it in: it runs
locally, passes, and ships. But CI never executes it, so it never runs on a pull
request. The failure mode is exactly the one the guard exists to prevent -- the
forbidden pattern reaching main behind a green tick -- and nothing signals it.
It is usually found only by going looking after the push.

## WRONG

```jsonc
// package.json
"check:new-guard": "node scripts/check-new-guard.mjs",
"check:all": "pnpm check:lint && pnpm check:scope && pnpm check:new-guard && pnpm test"
```

```yaml
# .github/workflows/ci.yml -- steps run individually; check:all is never called
- run: pnpm check:lint
- run: pnpm check:scope
- run: pnpm test
```

## RIGHT

```yaml
# Self-test BEFORE the guard: a guard whose patterns were narrowed to match
# nothing is indistinguishable from a clean repo. Verify the ruler, then measure.
- name: Guard self-test (new guard)
  run: node --test scripts/check-new-guard.test.mjs
- name: New guard
  run: pnpm check:new-guard
```

```js
// Meta-check (run in CI): every check:* in check:all must appear in the workflow.
const all = pkg.scripts['check:all'].match(/check:[\w-]+/g) ?? [];
const missing = all.filter((name) => !workflowYaml.includes(name));
if (missing.length) throw new Error(`in check:all but not CI: ${missing.join(', ')}`);
```

## NOTES

- `check:all` is a developer convenience; the workflow file is the enforcement.
  Adding a guard means editing both.
- After pushing, confirm the new step name appears in the run log -- a step that
  is absent does not show as skipped, it just is not there.
- Related: `red-verify-skips-suite-and-deploy.md` (a guard that fails first
  skips every later step).
