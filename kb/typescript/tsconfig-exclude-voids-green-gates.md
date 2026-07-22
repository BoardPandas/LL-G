---
tech: typescript
tags: [tsconfig, exclude, coverage, vitest, verification, false-green, referenceerror, monorepo]
severity: high
---
# A green typecheck + test run can prove nothing about an entire directory

## PROBLEM

`typecheck:all` and `test:all` passing feels like proof the tree is sound. It is only proof about the files each tool actually looked at. A directory that is **excluded from every tsconfig** and **has no test files** is covered by neither -- yet it still passes both gates, because passing a gate you were never in is free.

This is not hypothetical shelfware: it is usually the browser/static-asset tree, which is exactly where hand-written JS with no types lives.

Two exclusions in one repo:

```jsonc
// tsconfig.server.json
"exclude": ["node_modules", "dist", "src/server/__tests__"]
// dashboard/tsconfig.json
"exclude": ["node_modules", "dist", "src/public"]
```

`dashboard/src/public/**` is ~316 browser ES modules served statically -- no bundler, no build step, no tsc, no tests. `src/server/__tests__` holds real `.ts` test files that vitest only *transpiles* (types stripped, never checked).

The consequence, observed: two `ReferenceError`s were introduced into that directory -- an undefined identifier injected at a call site, and a destructured binding removed from a function that used it. The **full 2041-test suite passed with both bugs in the tree**, as did `build:all` and `typecheck:all`. Every gate was green. Nothing executed those files.

The same blind spot explains why `any` density is always highest there: no tool ever pushed back.

## WRONG

```bash
pnpm run build:all && pnpm run typecheck:all && pnpm run test:all
# Test Files 167 passed | Tests 2041 passed
# -> "verified, safe to ship"     <- says nothing about the 316 files in src/public
```

## RIGHT

```bash
# 1. Find out what your gates actually cover, once, and write it down.
grep -A4 '"exclude"' tsconfig*.json */tsconfig.json
#   -> src/public and src/server/__tests__ are in NO program

# 2. For an excluded, untested JS tree, run a scope/undeclared-variable check.
#    This catches the ReferenceError class that tsc would have caught.
biome check --only=correctness/noUndeclaredVariables dashboard/src/public

# 3. VALIDATE the check actually fires before trusting it -- the rule is not in
#    Biome's recommended preset, and a file outside `files.includes` is skipped
#    silently, so a clean run can mean "found nothing" OR "checked nothing".
printf 'export function t(){ return totallyUndefinedThing + 1; }\n' > dashboard/src/public/__probe.js
biome check --only=correctness/noUndeclaredVariables dashboard/src/public/__probe.js   # MUST report 1 error
rm dashboard/src/public/__probe.js

# 4. Syntax + import-graph checks for a no-bundler ES-module tree:
node --check <file>.js                      # parse errors
#    plus a resolver over the tree: every specifier resolves to a real file and
#    every named import matches an actual export (follow `export *` chains).
```

## NOTES

- The probe step is the important half. An empty result from a non-preset rule is ambiguous by default; a deliberate failing probe converts it into a real signal. Same applies to any `--only=<rule>` run.
- Excluding `src/public` from the dashboard program is *correct* (it is untyped static JS and would need `allowJs`). The bug is not the exclusion, it is assuming the aggregate gate covered it anyway.
- Excluding a `__tests__` directory from tsc is common and quietly costly: those files are still TypeScript, and type errors in them surface only as runtime failures, if at all.
- Ask "which program is this file in?" before trusting a green run over it. `tsc -p <config> --listFiles | grep <file>` answers it definitively.
- `tsc --noEmit` writes nothing, so it is safe to run concurrently (multiple agents, watch processes). A package script that wraps it with a `build:deps` step is not -- that writes shared `dist/`.
- Related: the biome entry on a mass reformat breaking a CI gate -- same theme, a check that was green for reasons you did not model.
