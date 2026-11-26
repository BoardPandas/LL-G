---
tech: jest
tags: [esm, exports, import-condition, transformIgnorePatterns, pnpm, resolution]
severity: medium
---
# A package whose `exports` offer only an `import` condition cannot be resolved by name in a CommonJS Jest suite

## PROBLEM
Some ESM-only packages declare each subpath with only `types` and `import` conditions and no `require` or `default`:

```json
"exports": { "./core": { "types": "./dist/core/index.d.ts", "import": "./dist/core/index.js" } }
```

Jest running in CommonJS mode resolves with the `require` condition, finds no match, and reports `Cannot find module '<pkg>/core'` even though the package is installed and TypeScript resolves its types. Adding the package to the `transformIgnorePatterns` allow-list, the usual fix for an ESM-only dependency, changes nothing: that setting decides whether a file is transformed after it has been found, and here it is never found.

## WRONG
```ts
// jest.config.js: the package is in the ESM transform allow-list, and still:
import { TaskSchema } from '@scope/pkg/core';     // Cannot find module '@scope/pkg/core'
```

## RIGHT
```ts
// Load the file by its path, so no exports condition is consulted,
// and keep the allow-list entry so Jest transforms the ESM it finds there.
import path from 'node:path';
const pkgRoot = path.join(process.cwd(), 'node_modules', '@scope', 'pkg');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TaskSchema } = require(path.join(pkgRoot, 'dist', 'core', 'index.js'));
```

## NOTES
- Both halves are needed: the path import gets past resolution, and the `transformIgnorePatterns` entry lets Jest compile the ESM source.
- Under pnpm the allow-list pattern must match the package name at the second `node_modules` segment (`node_modules/.pnpm/<pkg>@x/node_modules/<pkg>/`).
- Keep the path import in one test helper, so a package update that moves the file breaks one place.
- A `moduleNameMapper` entry pointing the name at the file is an alternative when many tests import it.
- Check `npm view <pkg> exports` before choosing a package for use in tests.
