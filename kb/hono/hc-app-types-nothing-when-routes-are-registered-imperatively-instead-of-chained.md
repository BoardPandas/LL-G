---
tech: hono
tags: [rpc, hc, apptype, openapihono, zod-openapi, type-drift, satisfies]
severity: high
---
# hc<App> types nothing when routes are registered imperatively instead of chained

## PROBLEM
Hono's RPC client `hc<App>` only knows the routes whose types were accumulated by chaining (`app.get(...).post(...)` or `app.route(...)` with the returned value), so routes registered by side effect leave `App` with no route schema and every client call is untyped.
It is not obvious because everything compiles: `hc<App>("/")` builds fine, `App = ReturnType<typeof createApp>` looks fully typed, and the frontend falls back to string-path fetches with hand-copied response types. Those copies drift silently. In one case a budget form sent `monthlyCapUsd` to a `.strict()` zod-openapi body expecting `limitUsd` (every save rejected), and the page read a usage shape the API never returned (spend showed 0, chart never rendered), while all tests passed against fixtures of the copied shape.

## WRONG
```typescript
// api/app.ts
export function createApp(deps: Deps) {
  const app = new OpenAPIHono();
  registerCostRoutes(app, deps.costs); // app.openapi(...) called inside; return value discarded
  registerRunRoutes(app, deps.runs);
  return app; // type has no routes
}
export type App = ReturnType<typeof createApp>;

// web/lib/api.ts
export const rpcClient = hc<App>("/"); // compiles, types nothing
export interface UsageSummaryResponse { monthSpendUsd: number; monthlyCapUsd: number | null } // hand-copied, wrong
```

## RIGHT
```typescript
// Option A: chain so the type accumulates
const app = new OpenAPIHono().openapi(usageRoute, usageHandler).openapi(budgetPutRoute, putHandler);
export type App = typeof app;

// Option B (imperative registration kept): re-export the real types, import type-only
// api/app.ts
export type { BudgetView, CostsService, UsageRollupView } from "./costs/types.js";
// web/lib/api.ts
import type { CostsService } from "@agents/api/app";
export type { BudgetView, UsageRollupView } from "@agents/api/app";
export type BudgetInput = Parameters<CostsService["upsertBudget"]>[2];

// tests: bind fixtures to server types so drift fails tsc
JSON.stringify({ periodMonth: "2026-10", totals: {/*...*/}, byAgent: [], dailySeries: [] } satisfies UsageRollupView);
expect(JSON.parse(String(putInit.body))).toEqual({ limitUsd: 300, warnPct: 85 } satisfies BudgetInput);
```

## NOTES
Quick check: hover a call like `rpcClient.v1.clients[":clientId"].usage.$get` — if the property chain is not offered, `App` carries no routes. A `.strict()` schema turns any renamed key into a 400, so field-name drift shows up as "the form never saves", not as a type error. Related: `typescript/copied-api-types-hide-runtime-contract-drift`, `hono/route-registration-order-on-split`.
