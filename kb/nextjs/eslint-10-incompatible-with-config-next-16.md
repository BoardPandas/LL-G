# ESLint 10 crashes eslint-config-next 16 (eslint-plugin-react getFilename)

**Severity:** HIGH
**Technology:** nextjs
**Date Added:** 2026-05-31
**Tags:** eslint, eslint-config-next, eslint-plugin-react, peer-dependencies, legacy-peer-deps, linting

## Symptom

After installing ESLint 10.x in a Next.js project that lints with `eslint-config-next` (Next 16), every `npm run lint` / `npx eslint <anyfile>` crashes before reporting any results:

```
Oops! Something went wrong! :(

ESLint: 10.4.0

TypeError: Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function
    at resolveBasedir (node_modules/eslint-plugin-react/lib/util/version.js:31)
    at detectReactVersion (node_modules/eslint-plugin-react/lib/util/version.js:85)
```

This blocks ALL linting (and any future lint-in-CI). Note it does NOT block `next build`: Next 16 no longer runs ESLint during builds, so deploys keep working and the breakage can go unnoticed. See [next build does not run ESLint in Next 16](next-build-skips-eslint.md).

## Root Cause

`eslint-config-next` 16 officially supports ESLint 9.x only (its peer range is `^7.23.0 || ^8.0.0 || ^9.0.0`). It pulls in `eslint-plugin-react` transitively (latest is 7.37.5), whose peer range tops out at `^9.7` -- and no published `eslint-plugin-react` supports ESLint 10. ESLint 10 removed the old `context.getFilename()` form, which `eslint-plugin-react`'s `version.js` (`resolveBasedir`) still calls, so the plugin throws the moment any React rule loads.

The trap: a repo with `legacy-peer-deps=true` in `.npmrc` installs ESLint 10 silently with NO peer-conflict warning, so the incompatible combo lands undetected until someone actually runs lint.

## Solution

Pin ESLint to the 9.x line that `eslint-config-next` supports, across every workspace package, so a single hoisted copy satisfies the config. Do NOT try to upgrade `eslint-plugin-react` -- there is no ESLint-10-compatible release yet.

```jsonc
// Before (broken) -- root, dashboard, and admin package.json
"devDependencies": {
  "eslint": "^10.4.0"
}

// After (fixed) -- same value in ALL workspace packages so one copy hoists
"devDependencies": {
  "eslint": "^9.39.4"
}
```

Then reinstall and verify the crash is gone:

```bash
npm install
npx eslint src/app/page.tsx   # runs instead of throwing getFilename TypeError
```

Tip: confirm a single hoisted ESLint and that no workspace pulled a nested 10.x:
`node -e "console.log(require('eslint/package.json').version)"`.

## References

- ESLint 10 removed deprecated context methods (`context.getFilename()` -> `context.filename`)
- eslint-plugin-react peer dependency on `eslint` (`^3 || ... || ^9.7`)
- Related: [next build does not run ESLint in Next 16](next-build-skips-eslint.md)
