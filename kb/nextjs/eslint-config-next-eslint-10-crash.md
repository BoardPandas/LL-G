---
tech: nextjs
tags: [eslint, eslint-config-next, eslint-plugin-react, linting, eslint-10, next-16, legacy-peer-deps]
severity: high
---
# eslint-config-next 16 + ESLint 10 crash via eslint-plugin-react

## PROBLEM
In a Next.js 16 app whose flat config extends `eslint-config-next/core-web-vitals`, running `eslint .` (or `next lint`) under ESLint 10.x crashes for every file:

```
TypeError: Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function
  at resolveBasedir (node_modules/eslint-plugin-react/lib/util/version.js:31)
```

`eslint-config-next@16` bundles an `eslint-plugin-react` that still calls `context.getFilename()`, which ESLint 10 removed (the rule context API changed). The whole lint run dies before any rule evaluates.

What makes it silent and hard to debug: **Next.js 16 no longer runs ESLint during `next build`** (lint was decoupled from build). So builds and deploys stay green while linting is completely broken. Any rules you add (e.g. jsx-a11y) never actually execute, and nobody notices until they run `npx eslint` by hand.

## WRONG
```json
// package.json -- ESLint 10 against eslint-config-next 16
{
  "devDependencies": {
    "eslint": "^10.4.0",
    "eslint-config-next": "^16.2.6"
  }
}
// npx eslint . -> TypeError: contextOrFilename.getFilename is not a function
```

## RIGHT
```json
// Pin ESLint to the 9.x line eslint-config-next 16 actually supports
// until eslint-plugin-react ships an ESLint-10-compatible release.
{
  "devDependencies": {
    "eslint": "^9.39.4",
    "eslint-config-next": "^16.2.6"
  }
}
// In a workspaces repo, pin eslint to the SAME ^9.x in every package
// (root + each app) so a single copy hoists and satisfies the config.
```
Then confirm linting actually runs: `npx eslint src/some/file.tsx` should report results, not throw.

## NOTES
Because `next build` does not run ESLint in Next 16, a crashing lint config is invisible in CI/build output -- always run `npx eslint` explicitly to detect it. Corollary: newly added lint rules can appear "configured" yet never fire if the runner is broken. Verify rule activation with an intentional violation after fixing the version.

Install trap: with `legacy-peer-deps=true` in `.npmrc`, npm installs ESLint 10 silently with no peer-conflict warning, so the incompatible combo lands undetected (eslint-config-next 16's eslint peer range tops out at `^9`, and the latest `eslint-plugin-react`, 7.37.5, peers only up to `^9.7`). No published `eslint-plugin-react` supports ESLint 10 yet, so upgrading the plugin is NOT currently an option -- pinning ESLint to 9.x is the only fix. Confirm a single hoisted copy with `node -e "console.log(require('eslint/package.json').version)"`.
