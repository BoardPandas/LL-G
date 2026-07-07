---
tech: typescript
tags: [tsc, esbuild, zod, out-of-memory, docker, build, monorepo, vendoring]
severity: medium
---
# tsc runs out of heap compiling many zod-heavy files; transpile with esbuild

## PROBLEM
`tsc` can exhaust the Node heap type-checking a project with ~100+ files that each build large
`zod` (v3) schemas. It dies with `FATAL ERROR: Ineffective mark-compacts near heap limit
Allocation failed - JavaScript heap out of memory`, typically after 1-3 minutes. The growth is
unbounded (deep zod type inference), so raising `--max-old-space-size` to 8192 just delays the
crash rather than fixing it, and it reproduces under both TypeScript 5.8 and 6.0. This bites
hardest in Docker/CI where the build container has less RAM than your workstation, so a package
that "builds fine locally" (bigger machine, higher default heap) fails the image build.

## WRONG
```jsonc
// package.json -- type-checks 140 zod-heavy files on every build; OOMs in Docker
{
  "scripts": { "build": "tsc" }
}
// Bumping the heap does NOT fix it -- memory use is unbounded:
//   NODE_OPTIONS=--max-old-space-size=8192 tsc   // still OOMs, just later
```

## RIGHT
```jsonc
// When you only need JS emit from known-good (e.g. vendored) code, skip type-checking
// and transpile+bundle with esbuild. Single ESM file in ~20ms, deps external.
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/index.js"
  },
  "devDependencies": { "esbuild": "^0.28.0" }
}
```

## NOTES
esbuild does not type-check, but it still fails on syntax errors, and for vendored code that
already runs in production you usually want the emit, not a re-check. `--packages=external` keeps
node_modules deps out of the bundle so they resolve at runtime (correct for a spawned Node child).
If you DO need type-checking, isolate the offending files or split the compile -- but for a big
zod schema surface, transpile-only is the reliable path. Unrelated to the TS6/typescript-eslint
peer-dep OOM (`ts6-peer-dep-conflict.md`), which is a dependency-resolution issue, not a
type-checker memory blowup.
