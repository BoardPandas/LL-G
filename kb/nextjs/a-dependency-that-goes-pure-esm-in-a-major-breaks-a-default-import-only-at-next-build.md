---
tech: nextjs
tags: [esm, default-import, major-bump, turbopack, next-build, web-push, types-drift, vi-mock, ci-gap]
severity: high
---
# A dependency that goes pure-ESM in a major breaks a default import only at next build

## PROBLEM
`web-push` 4.0.0 became a pure ES module with **named exports only**. The existing
`import webpush from "web-push"` kept passing every gate a typical CI runs:

- **tsc**: the stale `@types/web-push` 3.6.4 still declares a default export.
- **vitest**: a hand-written `vi.mock("web-push", () => ({ default: { ... } }))` supplies the
  default itself, so the real module shape is never consulted.
- **CI**: it ran lint, type-check and tests but not `next build`.

The deploy platform's `next build` then failed with Turbopack's
`Export default doesn't exist in target module`. A worker running the same file under Node ESM
(`node --import tsx`) throws `SyntaxError: The requested module does not provide an export named
'default'`. Both services failed to deploy, so the old release kept serving traffic. Observed
2026-11-21 on Next.js 16.4.6, pnpm 12.21.0 and Node 26.13.1.

## WRONG
```typescript
import webpush from "web-push";           // compiles, tests pass, next build fails
await webpush.sendNotification(sub, body, opts);

// test
vi.mock("web-push", () => ({ default: { sendNotification: send } }));
```

## RIGHT
```typescript
import { sendNotification } from "web-push";
await sendNotification(sub, body, opts);

// test: mock the module's REAL shape
vi.mock("web-push", () => ({ sendNotification: send }));
```
```bash
# After any major bump, ask the runtime, not the @types package:
node --input-type=module -e 'const m = await import("web-push"); console.log("default" in m)'
# ...and run a full build before pushing. Placeholder env lets page-data collection finish locally:
NEXT_PUBLIC_APP_URL=https://build-check.invalid BETTER_AUTH_URL=https://build-check.invalid pnpm build
```

## NOTES
- `@types/*` lag the package they describe; after a major they are evidence of the OLD shape.
- A module mock that names `default` hides the export shape from the test. Mock what the
  package actually exports.
- The fix for the gate is a build step in CI (or before push), not more unit tests.
