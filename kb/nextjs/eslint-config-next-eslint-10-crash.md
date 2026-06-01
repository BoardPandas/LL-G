---
tech: nextjs
tags: [eslint, eslint-config-next, eslint-plugin-react, linting, eslint-10, next-16]
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
    "eslint": "^9.40.0",
    "eslint-config-next": "^16.2.6"
  }
}
// (alternative) force a fixed eslint-plugin-react via a root package.json
// "overrides" if you must stay on ESLint 10.
```
Then confirm linting actually runs: `npx eslint src/some/file.tsx` should report results, not throw.

## NOTES
Because `next build` does not run ESLint in Next 16, a crashing lint config is invisible in CI/build output -- always run `npx eslint` explicitly to detect it. Corollary: newly added lint rules can appear "configured" yet never fire if the runner is broken. Verify rule activation with an intentional violation after fixing the version.
