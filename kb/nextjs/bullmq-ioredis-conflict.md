---
tech: nextjs
tags: [bullmq, ioredis, redis, worker, type-error]
severity: high
---
# BullMQ + separate ioredis causes type conflicts

## PROBLEM
Installing `ioredis` as a direct dependency alongside `bullmq` causes TypeScript type conflicts. BullMQ bundles its own version of ioredis internally (often a different minor version). When you create an `IORedis` instance from your direct install and pass it as `connection` to a BullMQ `Worker` or `Queue`, TypeScript reports incompatible types because the two ioredis versions have slightly different type definitions.

## WRONG
```bash
pnpm add bullmq ioredis  # two separate ioredis versions in node_modules
```

```ts
import { Worker } from "bullmq";
import IORedis from "ioredis";  // v5.10.0 (your install)

const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
});

// TS2322: Type 'Redis' is not assignable to type 'ConnectionOptions'
const worker = new Worker("queue", processor, { connection });
```

## RIGHT
```bash
pnpm add bullmq  # only install bullmq, it brings its own ioredis
```

```ts
import { Worker } from "bullmq";

const worker = new Worker(
  "queue",
  async (job) => { /* process */ },
  {
    connection: {
      url: process.env.REDIS_URL || "redis://localhost:6379",
      maxRetriesPerRequest: null,  // required for BullMQ
    },
  },
);
```

## NOTES
- Use BullMQ's built-in connection config object instead of an external IORedis instance
- `maxRetriesPerRequest: null` is required — without it, the worker throws on Redis connection retry
- If you need a standalone Redis client for non-BullMQ work (caching, sessions), import from BullMQ's bundled ioredis or use a separate Redis library like `redis`
