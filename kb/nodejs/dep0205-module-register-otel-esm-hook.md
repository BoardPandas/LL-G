---
tech: nodejs
tags: [nodejs, node-26, dep0205, module-register, registerhooks, opentelemetry, import-in-the-middle, esm, tracing, deprecation]
severity: medium
---
# Node 26 deprecates `module.register()` (DEP0205): load the OTel ESM hook with `registerHooks`

## PROBLEM
OpenTelemetry's documented ESM setup calls
`module.register('@opentelemetry/instrumentation/hook.mjs', import.meta.url)`. On Node 26 that
prints `[DEP0205] DeprecationWarning: module.register() is deprecated` to stderr at every boot,
which log platforms such as Railway file at error level. The obvious swap has a silent trap: the
synchronous hook runs in-thread and reads the `Hook()` registry of ITS OWN import-in-the-middle
copy, so if the app's import-in-the-middle resolves to a different copy than the one the OTel
instrumentations use, ESM modules simply stop being instrumented -- no error, fewer spans.

## WRONG
```ts
import { register } from 'node:module';
register('@opentelemetry/instrumentation/hook.mjs', import.meta.url); // DEP0205 on Node 26
```

## RIGHT
```ts
// import-in-the-middle >= 3.6 (the version @opentelemetry/instrumentation already depends on),
// added as a direct dependency at the SAME version so pnpm dedupes it to one copy.
const { register } = await import('import-in-the-middle/register-hooks.mjs');
register(); // module.registerHooks(): synchronous, in-thread, no deprecation
```
```ts
// Guard the single-instance requirement in a test.
const ours = createRequire(import.meta.url);
const theirs = createRequire(ours.resolve('@opentelemetry/instrumentation'));
expect(realpathSync(ours.resolve('import-in-the-middle')))
  .toBe(realpathSync(theirs.resolve('import-in-the-middle')));
```

## NOTES
- `register-hooks.mjs` throws on Node versions where `supportsSyncHooks()` is false
  (< 22.22.3, < 24.11.1, 25.0); on Node 26 it is always true.
- The deprecation warning is emitted on a later tick: a smoke script that calls
  `process.exit()` right after starting telemetry will not show it. Wait a few hundred ms.
- Verify instrumentation survived: an ESM named import (`import { request } from 'node:http'`)
  should still be the wrapped function (`request.__wrapped`) after the SDK starts; compare
  per-request span counts before and after the deploy.
