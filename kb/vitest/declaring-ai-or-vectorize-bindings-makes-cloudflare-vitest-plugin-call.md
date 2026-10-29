---
tech: vitest
tags: [cloudflare, workers-ai, vectorize, vitest-plugin, remote-bindings, miniflare, testing]
severity: high
---
# Declaring ai or vectorize bindings makes @cloudflare/vitest-plugin call Cloudflare with your wrangler login, and a same-named service binding cannot replace them

## PROBLEM

Workers AI and Vectorize have no local simulation. When `wrangler.jsonc` declares an `ai` or `vectorize` binding and the tests point `cloudflareTest({ wrangler: { configPath } })` at that file, the plugin's `remoteBindings` (default true) starts a remote proxy session for every test file: on a host with a logged-in wrangler, the "offline" suite refreshes the OAuth token and makes authenticated calls to Cloudflare. Without a login it only warns, and any call throws `Binding AI needs to be run remotely`. The suite still passes, so nothing tells you tests are reaching a real account.

## WRONG

- `remote: false` on the binding: wrangler throws a UserError for AI and Vectorize.
- `cloudflareTest({ remoteBindings: false })`: no network, but the stub stays and throws on use.
- `miniflare.serviceBindings: { AI: ... }` with the same name: the wrangler binding wins; your fake is never called.
- `miniflare: { ai: undefined }`: crashes `mergeWorkerOptions`.
- `vi.mock` of the client module: never reaches the Worker under this plugin.

## RIGHT

Give the tests a copy of the config without those bindings, and serve fakes under the binding names:

```ts
import { experimental_readRawConfig as readRawConfig } from "wrangler";
const { rawConfig } = readRawConfig({ config: path.join(root, "wrangler.jsonc") });
const { ai: _ai, vectorize: _vec, ...testConfig } = rawConfig;
const testConfigPath = path.join(root, ".wrangler", "vitest-wrangler.json"); // gitignored
writeFileSync(testConfigPath, JSON.stringify({ ...testConfig, main: path.join(root, "src", "index.ts") }));
// cloudflareTest({ wrangler: { configPath: testConfigPath }, miniflare: {
//   serviceBindings: { AI: { name: "fakes", entrypoint: "FakeAi" }, VECTORS: { name: "fakes", entrypoint: "FakeVectors" } },
//   workers: [{ name: "fakes", modules: [...] }] } })
```

The fakes are `WorkerEntrypoint` classes, called over RPC. Add a plain test that the real `wrangler.jsonc` still declares the bindings, since the suite no longer reads them from it.

## NOTES

- Seen with @cloudflare/vitest-plugin 1.4.x and Vitest 4.1.
- Rerun `wrangler types` after changing bindings; a committed `worker-configuration.d.ts` goes stale silently.
- `main` must be absolute in the copy, because the copy lives in another directory.
