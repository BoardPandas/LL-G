---
tech: cloudflare
tags: [workers, workerd, exports, entrypoint, hono, testing]
severity: medium
---
# A named export from the Worker's main module becomes an entrypoint

## PROBLEM
Exporting the Hono app (or anything with a `fetch`) by name from the Worker's main module so tests can import it -- `export { app }` beside `export default` -- does more than expose it to tests. workerd treats named exports of the main module as entrypoints: verified under `@cloudflare/vitest-plugin` 1.4.0, `exports` from `cloudflare:workers` listed `default` and `app`, and `exports.app.fetch` served real requests. It becomes reachable via service bindings / `ctx.exports` with its own semantics, and a test-only export silently widens the Worker's surface.

## WRONG
```ts
// src/index.ts
export const app = new Hono();      // now an entrypoint too
export default { fetch: app.fetch };
```

## RIGHT
```ts
// src/app.ts
export const app = new Hono();      // tests import this file
// src/index.ts
import { app } from "./app.ts";
export default { fetch: app.fetch, scheduled };
```

## NOTES
- `wrangler deploy --dry-run` does not evaluate the module, so it never shows this.
