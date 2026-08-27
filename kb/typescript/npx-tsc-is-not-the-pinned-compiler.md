---
tech: typescript
tags: [tsc, npx, ci, monorepo, pnpm, noUncheckedIndexedAccess, typescript7, package-scripts, eslint, verification]
severity: medium
---
# `npx tsc` is not the compiler CI runs when the repo pins a second TypeScript

## PROBLEM

`npx tsc` runs whatever `typescript` the package manager hoisted into
`node_modules/.bin`. That is frequently NOT the compiler the repo's own
`type-check` script invokes, because a monorepo migrating compilers installs the
new one under a *different package name* and points the scripts at it by path:

```json
{ "scripts": { "type-check": "node ../node_modules/typescript7/bin/tsc --noEmit" } }
```

Both compilers are installed. `npx tsc` finds `typescript` (5.x); CI runs
`typescript7` (7.x). The two disagree about real errors, and TS7 enables strict
checks TS5 does not — `noUncheckedIndexedAccess` most commonly. So:

```ts
const [link] = screen.getAllByRole('link', { name: '#848' })
expect(link.className).not.toContain('text-coral')
```

is clean under `npx tsc` and `error TS18048: 'link' is possibly 'undefined'`
under the compiler CI runs. You verify locally, see zero errors, push, and CI
goes red on a file you just type-checked. The local check was never wrong — it
answered a question nobody asked.

The same gap exists for every pinned tool, and it is not only about versions.
`npx eslint .` walks a different file scope than `pnpm run lint` (which usually
carries `--ext`, ignore paths, or a workspace filter), so the two report
different problem counts. Any repo gating on a warning-count floor can be
"unchanged" by the `npx` count and over the floor by the CI count.

Nothing about the local run signals the substitution: `npx tsc --version` prints
a plausible version, `--showConfig` reads the same tsconfig, and the exit code is
0. Only the binary differs.

## WRONG

```bash
# "Types are clean." Proves nothing about CI: resolves node_modules/.bin/tsc,
# which is TypeScript 5, while the repo's type-check script runs typescript7.
cd dashboard && npx tsc --noEmit

# Same class of mistake for lint -- different file scope than the CI step,
# so the problem count is not comparable to the ratchet floor CI enforces.
npx eslint .
```

## RIGHT

```bash
# Run the package's own script -- it names the pinned binary CI will use.
pnpm --filter supportforge-dashboard type-check
pnpm --filter supportforge-admin-portal type-check
pnpm --filter @supportforge/ui type-check

pnpm run lint
pnpm --filter supportforge-dashboard lint
```

```bash
# Confirm which binary you are actually about to run, before trusting a green.
node -p "require('./package.json').scripts['type-check']"
# -> "node ../node_modules/typescript7/bin/tsc --noEmit"

npx tsc --version                                    # Version 5.x  <- hoisted
node ./node_modules/typescript7/bin/tsc --version    # Version 7.x  <- what CI runs
```

Then read `.github/workflows/*.yml` for the actual step list and run those
commands, rather than equivalents you assume match.

## NOTES

- Severity MEDIUM because CI catches it loudly. The cost is a wasted red-CI
  cycle and a claim of "verified clean" that was not; nothing ships broken.
- Sibling to the "green tsc proves less than you think" family already here:
  `tsconfig-include-non-source`, `tsconfig-exclude-voids-green-gates`,
  `tsconfig-include-entrypoints-hides-unreferenced-files`, and
  `tsconfig-glob-skips-dot-directories`. Those are all *one* compiler exiting 0
  over a program missing your file. This one is the file being checked correctly
  by the *wrong compiler*. Same lesson: `tsc --noEmit` exiting 0 is only evidence
  once you know which compiler read which files.
- `noUncheckedIndexedAccess` makes every `arr[i]` and destructured element
  `T | undefined`. Test files are hit hardest, because Testing Library's
  `getAllBy*` queries return arrays that get destructured for a single element.
  Iterating the whole array is usually the better assertion anyway.
- Applies to any pinned tool invoked by path in a script: prettier, jest, biome,
  vitest, a second eslint. If the script does not say plain `tsc`/`eslint`, `npx`
  is the wrong way to reproduce it.
- The trap gets worse mid-migration: while both compilers are installed, local
  and CI disagree indefinitely, and nothing warns you. It disappears only when
  the old package is removed.
