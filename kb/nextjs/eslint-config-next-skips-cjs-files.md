---
tech: nextjs
tags: [eslint, eslint-config-next, flat-config, cjs, eslint-plugin-react, lint]
severity: medium
---
# eslint-config-next skips .cjs files, so adding one crashes lint with "could not find plugin react"

## PROBLEM
eslint-config-next (16.x, flat config) registers the `react`, `react-hooks`, `import` and `jsx-a11y` plugins in a config object scoped to `files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"]`. `.cjs` is not in that list.

If the app's own `eslint.config.mjs` has a rules block with **no `files` key** that sets a `react/*` rule, that block applies to `.cjs` files while the plugin does not. Adding the first `.cjs` file to the package makes the whole ESLint run abort:

```
A configuration object specifies rule "react/no-unescaped-entities", but could not find plugin "react".
```

It reads like a broken install, especially right after a dependency bump. `git stash` does not stash the new untracked `.cjs` file, so "the crash happens without my change" too, and it looks pre-existing.

## WRONG
```js
// eslint.config.mjs
export default [
  ...nextCoreWebVitals,
  { rules: { 'react/no-unescaped-entities': 'warn' } }, // applies to every file, .cjs included
]
// then add portal/security-policy.cjs -> lint crashes for the whole package
```

## RIGHT
```js
// Either name the CommonJS module .js (in a package without "type": "module")...
// portal/security-policy.js

// ...or scope the rules block to the files the plugin covers:
{ files: ['**/*.{js,jsx,mjs,ts,tsx,mts,cts}'], rules: { 'react/no-unescaped-entities': 'warn' } }
```

## NOTES
- Bisect with `npx eslint <one-file>`: the new `.cjs` file alone reproduces it, an existing `.ts` file does not.
- Related: [eslint-config-next-eslint-10-crash.md](eslint-config-next-eslint-10-crash.md) and [eslint-flat-config-plugin-redefine.md](eslint-flat-config-plugin-redefine.md) are different crashes with similar messages.
