---
tech: vitest
tags: [cloudflare, workers, workerd, vi.mock, AsyncLocalStorage, vitest-5, miniflare]
severity: high
---
# Vitest 5 under @cloudflare/vitest-plugin fails any file whose vi.mock factory runs: workerd throws on AsyncLocalStorage#disable()

## PROBLEM
`@cloudflare/vitest-plugin` 1.4.0 and later peer on `vitest ^4.1.0 || ^5.0.0`, and most of a suite runs fine on Vitest 5.1.0. But a test file whose `vi.mock(id, factory)` factory actually runs fails at import with:

```
Error: asyncLocalStorage.disable() is not implemented
 ❯ src/whatever.ts:13:1   <- the import of the mocked module
```

The stack points at the import of the mocked module, not at Vitest, so it reads like a bug in that dependency. The real cause is in Vitest's module mocker (`resolveMockOnce`). Once every pending mock factory settles it calls `this.factoryContexts.disable()` on an `AsyncLocalStorage`, only so an idle storage stops slowing promises on Node 22. workerd implements `AsyncLocalStorage` but throws on `disable()`. Vitest 4.1 does not make that call, so the failure appears only after the major bump, and only in files with a factory mock (often one isolation test among many).

## WRONG
Pinning back to Vitest 4 because of an older note that says "the plugin needs Vitest ^4.1". That is no longer true, so you lose the update for one method call. Also wrong: blaming the mocked package (here `agents/mcp/server`) because the stack ends there.

## RIGHT
In a `setupFiles` module, which runs inside workerd before the test file's mocks resolve, replace `disable()` with a no-op, but only while workerd still throws:

```ts
import { AsyncLocalStorage } from "node:async_hooks";

try {
  new AsyncLocalStorage().disable();
} catch {
  Object.defineProperty(AsyncLocalStorage.prototype, "disable", {
    configurable: true,
    writable: true,
    value: () => {
      // Nothing to release: Vitest enters the storage with run() each time.
    },
  });
}
```

A no-op changes nothing observable, because `getStore()` outside `run()` is `undefined` either way. If the Worker tsconfig carries no Node types, declare `node:async_hooks` with just the `AsyncLocalStorage` class in an ambient `.d.ts`.

## NOTES
- Seen with vitest 5.1.0, @cloudflare/vitest-plugin 1.5.0, miniflare 5.20261102.0-beta and workerd 1.20261102.1.
- The probe is a cheap way to find it: patch `disable` to push `new Error().stack` into an array, then assert the array is empty. The stack names `vitest/dist/chunks/index.*.js` in `resolveMockOnce`.
- This supersedes the advice in `vitest/cloudflare-vitest-plugin-requires-vitest-4-1` for plugin 1.4.0 and later.
