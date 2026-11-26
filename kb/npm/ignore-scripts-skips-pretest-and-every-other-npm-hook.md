---
tech: npm
tags: [npm, ignore-scripts, pretest, lifecycle-scripts, npmrc, ci, docker, build-order]
severity: high
---
# With `ignore-scripts=true`, `npm test` does not run `pretest` (or any pre/post hook)

## PROBLEM
`ignore-scripts=true` in `.npmrc` (a common supply-chain hardening) keeps npm from running lifecycle scripts. Commands that explicitly name a script, such as `npm test`, `npm start` and `npm run <name>`, still run that script, but npm no longer runs its `pre` and `post` hooks. A `"pretest": "npm run build"` that used to guarantee a build before the suite silently stops running. The suite then passes where a build output exists from an earlier run, and fails on a clean checkout, in CI or in a fresh image, or it tests a view or bundle that was never built.

## WRONG
```json
{
  "scripts": {
    "pretest": "npm run build",
    "test": "node --test"
  }
}
```
```ini
# .npmrc
ignore-scripts=true
```
`npm test` goes straight to `node --test`.

## RIGHT
```json
{
  "scripts": {
    "build": "tsc -b",
    "test": "npm run build && node --test"
  }
}
```
Or build what a test needs on demand in the test helper, and have the image or CI job run the build explicitly before the tests:
```ts
// tests/helpers/built-view.ts
export async function ensureBuilt() {
  if (!existsSync(OUTPUT)) execFileSync("npm", ["run", "build:view"], { stdio: "inherit" });
}
```

## NOTES
- Check `npm config get ignore-scripts` on the machine that runs the suite; developers, CI and the image can differ.
- Prove a fix by deleting the build output and running the suite from a clean tree.
- The same applies to `prebuild`, `postinstall`, `prepare` and every other hook; do not rely on one to produce a prerequisite.
