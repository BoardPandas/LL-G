---
tech: supportforge
tags: [supportforge, task-registry, background-jobs, imports, scripts, tsx, jest, side-effects]
severity: medium
---
# A job module that records task runs boots the whole API server when imported outside Jest

## PROBLEM
`src/services/task-registry.ts` gets its pool with `import { db } from '../server'` rather than from `../lib/db`. `server.ts` is not a library: importing it builds the Express app, validates production secrets and starts the server. Every background job that records its runs (`recordTaskStart` / `recordTaskComplete` / `isTaskRunning`) imports the task registry: the sequence ticker, the campaign sender, the workflow runner and 17 other modules. So importing one of them from a standalone `tsx` script, e.g. to exercise a job's SQL against a scratch Postgres, fails with `JWT_SECRET environment variable is required. Set it before starting the server.` In an environment that has the secrets set, it starts a real server instead.

Jest never shows it: every suite that touches these modules declares `jest.mock('../server', () => ({ db: { query: jest.fn() } }))`, which is why the coupling survives.

## WRONG
```typescript
// scratch-check.ts -- run with tsx against PGlite
import { runCampaignTick } from '../src/services/people/campaign-sender';
// -> campaign-sender imports task-registry -> imports ../server
// -> "JWT_SECRET environment variable is required" before any SQL runs
await runCampaignTick(pglitePool, { mode: 'on', maxPerTick: 50, spacingMs: 0 });
```

## RIGHT
```typescript
// Import the job's parts, which take a queryable and never touch the registry,
// and reassemble the tick in the script.
import { promoteDueCampaigns } from '../src/services/people/campaign-promotion';
import { deliverPending } from '../src/services/people/campaign-delivery';
import { completeFinishedCampaigns } from '../src/services/people/campaign-sends';

await promoteDueCampaigns(pool, result);
await deliverPending(pool, result, { maxPerTick: 50, spacingMs: 0 });
await completeFinishedCampaigns(pool);
```

## NOTES
- When writing a new job, keep the SQL and the per-item work in modules that take an `RmmQueryable` and import nothing from the registry. Keep `record*` and the scheduler in a thin outer module. That split is what makes the parts importable.
- Also set `DATABASE_URL` to an unreachable address in such scripts. `src/lib/db.ts` runs `dotenv.config()` and falls back to a localhost URL, and modules like `getBranding` quietly use that pool, so a script run from a checkout with a real `.env` can read production.
- The durable fix is for `task-registry.ts` to import `db` from `../lib/db`, which is the shared pool `server.ts` itself re-exports.
