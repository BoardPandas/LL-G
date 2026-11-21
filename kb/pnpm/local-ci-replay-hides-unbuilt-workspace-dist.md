---
tech: pnpm
tags: [workspace, monorepo, dist, ci, local-ci, build-order, tsx, gates]
severity: medium
---
# A local CI replay that reuses node_modules passes on a workspace `dist/` that CI never built

## PROBLEM
A script that replays CI's steps locally (to avoid waiting for the real pipeline) usually
reuses the installed `node_modules` and whatever build output is already on disk. A clean CI
checkout has neither. So a step that silently depends on a workspace package's `dist/` passes
locally and fails in CI with `Cannot find module '.../node_modules/@scope/pkg/dist/x.js'`.

The trigger is often indirect. A guard script run with `tsx` (a schema-drift check, say)
imports an app module; that module gains a new import of a built workspace package; the guard
step sits in the CI job *before* the step that builds the package. The full local replay was
green, every test was green, and the deploy is blocked on a step that never touched the
package.

## WRONG
```jsonc
// package.json
"check:auth-schema": "tsx scripts/check-schema.ts"   // loads src/lib/auth.ts -> @scope/pkg/dist
```
```bash
pnpm run check:ci        # green: dist/ left over from earlier builds
```

## RIGHT
```jsonc
// Each script builds the workspace output it loads, whatever CI step runs it first.
"check:auth-schema": "pnpm --filter @scope/pkg build && tsx scripts/check-schema.ts"
```
```bash
rm -rf packages/pkg/dist           # replay the failing job from a clean build
pnpm run check:ci --only <job>
```

## NOTES
- After adding an import of a built workspace package, rerun the affected CI job locally with
  its `dist/` deleted before pushing.
- Related: [stale-workspace-dist-blames-the-consumer.md](stale-workspace-dist-blames-the-consumer.md)
  (the stale-output case pointing the other way).
