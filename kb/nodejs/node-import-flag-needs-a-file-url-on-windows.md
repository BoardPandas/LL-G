---
tech: nodejs
tags: [esm, import, preload, windows, file-url, spawn, tests]
severity: medium
---
# `node --import C:\path` fails on Windows: pass a `file://` URL

## PROBLEM
`--import` takes an ESM module *specifier*, not a file path. On Linux and macOS an
absolute path such as `/app/preload.mjs` happens to be a valid specifier. On
Windows, `C:\app\preload.mjs` is parsed as a URL whose scheme is `c:`, and Node
exits 1 before running anything:

```
Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only URLs with a scheme in: file, data,
and node are supported by the default ESM loader. On Windows, absolute paths must
be valid file:// URLs. Received protocol 'c:'
```

Tests that spawn `process.execPath` with `--import <join(...)>` pass on Linux CI
and fail on every Windows machine. `--require` (CommonJS) and the entry script
itself take paths and are not affected.

## WRONG
```js
spawnSync(process.execPath, ['--import', join(dir, 'preload.mjs'), entry]);
```

## RIGHT
```js
import { pathToFileURL } from 'node:url';

spawnSync(process.execPath, ['--import', pathToFileURL(join(dir, 'preload.mjs')).href, entry]);
```

## NOTES
- The same applies to `--loader`, `--experimental-loader`, `import()` of an
  absolute path, and `NODE_OPTIONS=--import ...`.
- A relative specifier such as `--import ./scripts/preload.mjs` works on every
  platform, which is why the production command line can be fine while the
  tests, which build absolute paths, fail.
