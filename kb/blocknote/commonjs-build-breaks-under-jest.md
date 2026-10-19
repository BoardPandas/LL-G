---
tech: blocknote
tags: [blocknote, jest, esm, commonjs, moduleNameMapper, transformIgnorePatterns, pnpm]
severity: medium
---
# BlockNote's CommonJS build breaks under Jest

## PROBLEM
Importing `@blocknote/core` (or `@blocknote/react` / `@blocknote/shadcn`) in a Jest suite first fails with ESM syntax errors from its dependencies. Allow-listing those only moves the failure: Jest then resolves BlockNote's CommonJS `dist` build, which crashes with `ee.default.extend is not a function` (a mangled Tiptap default-export interop failure).

Two further traps: pnpm store paths spell scoped packages `@scope+name` (`node_modules/.pnpm/@blocknote+core@0.56.0/...`), so a transform pattern matching only `@blocknote/` misses them; and `@handlewithcare/prosemirror-inputrules` exports only an `import` condition, so Jest's CommonJS resolver cannot find it at all.

## WRONG
```js
// jest.config.js
transformIgnorePatterns: ['node_modules/(?!(@blocknote/)/)'],
// -> misses .pnpm/@blocknote+core@..., then CJS build -> "ee.default.extend is not a function"
```

## RIGHT
```js
// jest.config.js
const path = require('path');
const esmDist = (pkg) => path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'dist');

module.exports = {
  moduleNameMapper: {
    // Force the ESM builds (check the actual file names in each dist/)
    '^@blocknote/(core|react|shadcn)$': '<rootDir>/node_modules/@blocknote/$1/dist/blocknote-$1.js',
    '^@blocknote/(core|react|shadcn)/(.*)$': '<rootDir>/node_modules/@blocknote/$1/dist/$2',
    // import-only export map: point straight at the file
    '^@handlewithcare/prosemirror-inputrules$':
      require.resolve('@handlewithcare/prosemirror-inputrules', { paths: [__dirname] }) /* or a path lookup into dist */,
  },
  transformIgnorePatterns: [
    // match both "@blocknote/" and pnpm's "@blocknote+"
    'node_modules/(?!(\\.pnpm/)?(@blocknote[/+]|lib0|prosemirror-highlight|@handlewithcare[/+]))',
  ],
};
```

## NOTES
- The allow-list that worked in the spike: `@blocknote`, `lib0`, `prosemirror-highlight`, `@handlewithcare`.
- If `require.resolve` also fails for `@handlewithcare/prosemirror-inputrules` (import-only exports), build the path by hand from the package directory to its `dist` ESM file.
- Observed on BlockNote 0.56.0, Jest in a Next.js 16 / pnpm 12 dashboard, 2026-10-19.
