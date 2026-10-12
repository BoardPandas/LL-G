---
tech: cloudflare
tags: [workers, wrangler, compatibility-date, nodejs-compat, async-hooks, agents, configuration]
severity: medium
---
# From `compatibility_date` 2026-08-04, `nodejs_compat` is on by default

## PROBLEM
Workers with `compatibility_date` 2026-08-04 or later get `nodejs_compat` and `nodejs_compat_v2` enabled by default. A `node:*` import, such as `agents/mcp/server` importing `AsyncLocalStorage` from `node:async_hooks` at top level, then builds and runs with no flag, and a "no nodejs_compat" comment in the wrangler config or an ADR quietly becomes false.

Opting out takes both `no_nodejs_compat` and `no_nodejs_compat_v2` (or an earlier date). In that configuration wrangler only **warns** ("The package "node:async_hooks" wasn't found on the file system but is built into node ... enable nodejs_compat") and the build still succeeds. `@cloudflare/vitest-plugin` ran the import under all three configurations, so the test suite cannot tell them apart; only the build warning can.

## WRONG
```jsonc
// wrangler.jsonc
{
  "compatibility_date": "2026-09-01",
  // No nodejs_compat: Web APIs only.   <- false: default-on from 2026-08-04
  "compatibility_flags": []
}
```

## RIGHT
```jsonc
{
  "compatibility_date": "2026-09-01",
  // nodejs_compat and nodejs_compat_v2 are default-on from 2026-08-04, and
  // agents/mcp/server relies on node:async_hooks. Opting out takes BOTH
  // "no_nodejs_compat" and "no_nodejs_compat_v2".
  "compatibility_flags": []
}
```

## NOTES
- For a dependency that needs only `AsyncLocalStorage`, the narrower `nodejs_als` flag alone also builds cleanly.
- Fail CI on the warning rather than reading it: grep the `wrangler deploy --dry-run` output for "wasn't found on the file system but is built into node".
- Verified with wrangler 4.149.0, 2026-10-12.
