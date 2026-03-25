# TypeScript 6 peer dependency conflict with typescript-eslint

**Severity:** HIGH
**Tech:** TypeScript, ESLint
**Added:** 2026-03-25

## The gotcha

`@typescript-eslint/eslint-plugin` and `@typescript-eslint/parser` version 8.x declare a peer dependency of `typescript >=4.8.4 <6.0.0`. Upgrading to TypeScript 6.0 causes `npm ci` to fail with `ERESOLVE` in any environment using strict peer dependency resolution (default since npm 7+), including Docker builds.

The error is clear locally but easy to miss if you upgrade TypeScript in dev (where `node_modules` already exists and npm skips resolution) and only discover it when CI/CD runs a clean `npm ci`.

## What goes wrong

```
npm error Could not resolve dependency:
npm error peer typescript@">=4.8.4 <6.0.0" from @typescript-eslint/eslint-plugin@8.57.x
```

Both the builder and production stages of a multi-stage Dockerfile fail. The build never reaches compilation.

## Fix

Add `.npmrc` with `legacy-peer-deps=true` to every package root that has the conflict. This tells npm to fall back to npm 6 behavior and skip strict peer dependency checks.

```ini
# .npmrc
legacy-peer-deps=true
```

Commit the `.npmrc` alongside the TypeScript upgrade so Docker and CI see it on clean installs.

## When to remove

Once `typescript-eslint` releases a version supporting TypeScript 6 (likely v9+), remove the `.npmrc` override and update the eslint packages. Check the [typescript-eslint releases](https://github.com/typescript-eslint/typescript-eslint/releases) for TS 6 support announcements.

## Checklist for future TypeScript major upgrades

1. Before upgrading, run `npm ls typescript` and check which packages declare peer dependencies on `typescript`.
2. Verify that all peer dependency ranges include the target TypeScript version.
3. If any package lags behind, add `legacy-peer-deps=true` to `.npmrc` as a bridge.
4. Add a reminder/TODO to remove the override once upstream catches up.
5. Test with `npm ci` (not `npm install`) to catch resolution failures before they hit CI/Docker.
