---
tech: pnpm
tags: [workspace, monorepo, build-order, dist, jest, tsc, gates]
severity: medium
---
# A stale workspace-package `dist/` blames your new code, not the build you forgot to run

## PROBLEM

A private workspace package consumed through `main`/`types`/`exports` pointing at
`dist/` is resolved from its **build output**, not its source — by `tsc`, by Node,
and by Jest alike. The `node_modules` entry is a symlink to the package
directory, so everything follows the same `dist/index.js` and `dist/index.d.ts`.

That is unremarkable until you add an export to the package and then run a gate
directly. `npx tsc --noEmit` and `npx jest` do **not** build workspace
dependencies. The repo's own script usually does:

```jsonc
"test": "pnpm --filter @scope/contracts build && jest"
```

so `pnpm test` works and the bare commands do not — including the bare commands
written into a runbook, a task file, or a CI step someone copied by hand.

The cost is the error message, which points at the consumer:

```
src/rmm/patching/contract.ts(54,3): error TS2724:
  '"@scope/contracts"' has no exported member named 'RmmPatchClassificationSchema'.
  Did you mean 'RmmArtifactClassificationSchema'?
```

Every signal says the import is wrong. The name is right there in the package's
`src/index.ts`, and the "did you mean" suggestion actively points somewhere
worse. At runtime the same staleness surfaces as the schema object being
`undefined`, so the failure is `Cannot read properties of undefined (reading
'safeParse')` — again inside your file, again nothing about a build.

## WRONG

```bash
# Added an export to packages/contracts/src and re-exported it from index.ts.
npx tsc --noEmit -p tsconfig.json     # TS2724: has no exported member
npx jest src/__tests__/               # TypeError: Cannot read properties of undefined
# ...then spend the next twenty minutes reading the import statement.
```

## RIGHT

Build the workspace dependency first — always, and especially before concluding
anything about a gate's output:

```bash
pnpm --filter @scope/contracts build
npx tsc --noEmit -p tsconfig.json
npx jest src/__tests__/
```

Confirm the built artifact actually carries the symbol before debugging the
consumer at all. This is a two-second check that settles it:

```bash
grep -c 'RmmPatchClassificationSchema' packages/contracts/dist/index.d.ts
grep -c 'RmmPatchClassificationSchema' packages/contracts/dist/index.js
```

Zero means the build is stale, not that the import is wrong.

## NOTES

- **The tell is a `tsc` error naming a symbol you can see in the package's
  source.** If the name is present in `src/index.ts` and absent from
  `dist/index.d.ts`, stop reading the consumer.
- Both halves go stale together, so `tsc` and Jest fail *in agreement*. That
  consistency is misleading — two gates agreeing looks like strong evidence the
  code is wrong.
- Whenever a documented verification gate lists bare `npx tsc` / `npx jest`
  rather than the package script, check `package.json` for what the script does
  first. A gate copied out of a runbook is exactly where the build step gets lost.
- `pnpm -r build` before the gate is the blunt fix; `--filter` is faster when you
  know which package moved.
- Related shape: `npm-install-contaminates-pnpm-node-modules.md`, where the
  installed tree disagrees with the lockfile and errors likewise blame the
  consumer.
