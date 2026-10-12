---
tech: vitest
tags: [cloudflare, vitest-plugin, workerd, vi-mock, vi-resetModules, module-cache, false-green]
severity: high
---
# `vi.mock` never reaches the Worker that @cloudflare/vitest-plugin serves

## PROBLEM
`@cloudflare/vitest-plugin` 1.4.0 (Vitest 4.1.11) loads and caches the Worker entrypoint before a test file's `vi.mock` registers. A `vi.mock` of a Worker dependency therefore never reaches the Worker that `exports.default` (from `cloudflare:workers`) serves, nor any `src/` module the test file imports statically. The test runs against the real dependency: a counting or spying mock records nothing, and an assertion like "built once per request" either fails confusingly or, if it only checks the response, passes without testing anything.

## WRONG
```ts
import { exports } from "cloudflare:workers";
import { buildServer } from "../src/mcp/handler.ts"; // static src import: loaded before the mock

const built = vi.hoisted(() => ({ handlers: 0 }));
vi.mock("agents/mcp/server", async (importOriginal) => { /* counting wrapper */ });

it("builds a handler per request", async () => {
  await exports.default.fetch(request); // real createMcpHandler runs; built.handlers stays 0
});
```

## RIGHT
```ts
// No static import of src/ or of the mocked module anywhere in this file.
const built = vi.hoisted(() => ({ handlers: 0 }));
vi.mock("agents/mcp/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("agents/mcp/server")>();
  const counted: typeof actual.createMcpHandler = (factory, options) => {
    built.handlers += 1;
    return actual.createMcpHandler(factory, options);
  };
  return { ...actual, createMcpHandler: counted };
});

type Fetch = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
let workerFetch: Fetch;
beforeAll(async () => {
  vi.resetModules(); // drop the cached Worker graph
  workerFetch = (await import("../src/index.ts")).default.fetch as Fetch; // beforeAll, not a test body
});

it("builds a handler per request", async () => {
  const ctx = createExecutionContext();
  await workerFetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  expect(built.handlers).toBe(1);
});
```

## NOTES
- Trap: if the same file also imports the mocked module statically, the mock is built before the reset against the old copy of its dependencies, and `resetModules` keeps it. The fresh graph then has a different `McpServer` class, so the SDK's `instanceof McpServer` check is false and every call is 500.
- Do the dynamic import in `beforeAll`: inside `it()` it is billed to that test's timeout (`dynamic-import-in-test-body.md`).
- Verified 2026-10-12.
