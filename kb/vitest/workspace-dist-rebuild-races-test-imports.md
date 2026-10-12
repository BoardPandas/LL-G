---
tech: vitest
tags: [monorepo, workspace, dist, build, concurrency, module-loading]
severity: high
---
# Rebuilding workspace dist during tests produces transient missing exports

## PROBLEM

Tests importing a workspace package through its compiled exports can read that
package while another verification command is rewriting its dist files. A named
export can then appear missing even though both source and the final built file
contain it. The broad failure looks like a code or mocking regression.

In one observed run, 111 dashboard tests failed with `saveImages is not a function`.
Those tests started at 17:26:27 while the imported package was rewritten through
17:26:33. Its own 7,872 tests passed, and the same failing consumer suite passed
5/5 when run alone after the build finished. No source edit or cache deletion
was needed for that control.

## WRONG

```bash
# All three commands share the workspace's generated dependency files.
pnpm run build:all &
pnpm run typecheck:all &
pnpm run test:all &
wait
```

## RIGHT

```bash
set -e
pnpm run check:guards
pnpm lint
pnpm run build:all
pnpm run typecheck:all
pnpm run test:all
```

## NOTES

A script named typecheck may still build dependencies first. Inspect its actual
commands instead of assuming it never writes. Parallelize only independent
work, or give jobs genuinely isolated generated-output directories.

Before changing production code, compare test start times with built-file mtimes,
check the current source and compiled exports, then rerun a representative case
without writers. Accept the complete verification result only after rerunning
the required full gates against frozen source with no concurrent builders.
