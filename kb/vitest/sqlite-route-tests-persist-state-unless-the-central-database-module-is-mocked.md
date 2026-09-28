---
tech: vitest
tags: [vitest, sqlite, test-isolation, self-hosted-runner, module-mocking]
severity: high
---
# SQLite route tests persist state unless the central database module is mocked

## PROBLEM

Setting a database-driver environment variable to `sqlite` does not make a route test
hermetic. If the production SQLite singleton derives a file path from the process working
directory, every fresh Vitest process can reopen the same ignored database. Fixed test user
ids then accumulate rows across local runs and reused self-hosted CI workspaces until caps or
uniqueness checks fail. Parallel workers can also contend on the same file. The suite may pass
in isolation and fail only under coverage or after enough repetitions, which points suspicion
at the route instead of the leaked test state.

## WRONG

```ts
process.env.DASHBOARD_DB_DRIVER = "sqlite";

// This still imports the production singleton, which opens a cwd-derived file.
const { buildRoutes } = await import("./index.js");
```

## RIGHT

```ts
import { vi } from "vitest";

process.env.DASHBOARD_DB_DRIVER = "sqlite";

vi.mock("../../lib/storage/sqlite.js", async () => {
  const { memoryDb } = await import("../../lib/storage/test-support.js");
  const db = memoryDb();
  return {
    getSqliteDb: () => db,
    getSqlitePath: () => ":memory:",
    getSqliteDataDir: () => "",
  };
});

// vi.mock is hoisted, so every store reached through this route graph uses the
// one fresh in-memory database owned by this test file.
const { buildRoutes } = await import("./index.js");
```

## NOTES

Do not diagnose this only by rerunning the failing assertion: inspect the resolved SQLite path
and count rows for the test identities. A passing retry is not evidence of isolation. Match the
repository's existing storage-module mock, use unique identities as a second line of defense,
and remove obsolete manual route registration when the production router already owns it.
