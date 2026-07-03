---
tech: pnpm
tags: [pnpm, typescript, nodenext, node_modules, symlink, types, winston-transport, node-linker, moduleResolution]
severity: high
---
# Packages with legacy bundled types (bare `/// <reference types="node" />`) fail tsc under pnpm + nodenext

## PROBLEM

A published package that ships old-style bundled types -- `export =` plus a bare
`/// <reference types="node" />` but WITHOUT declaring `@types/node` -- type-checks fine
under npm but fails under pnpm when the consuming project uses
`moduleResolution: nodenext`. `winston-transport` is the canonical example.

Symptom: `tsc` reports the class loses its `stream.Writable` base --
`Type 'RedisLogTransport' is missing the following properties from type 'TransportStream':
writable, writableAborted, writableEnded, writableFinished, and 34 more` -- and option
interfaces that `extends Transport.TransportStreamOptions` silently lose fields like
`level`. So `logger.add(new RedisLogTransport(...))` is rejected at compile time even
though it runs fine and builds clean under npm.

Root cause: npm installs real, flat directories, so the package's
`/// <reference types="node" />` resolves `@types/node` via the normal upward
`node_modules` walk. pnpm resolves the package to its `.pnpm/<pkg>@<ver>/node_modules/<pkg>`
store realpath (TS follows the symlink because `preserveSymlinks` is false), and from that
vantage the ambient `node` types don't resolve the same way, so `stream.Writable` degrades.

This is expensive to debug because it looks impossible: the package is byte-identical to
npm's, there are no duplicate copies (single `@types/node`, single package version), and
`tsc --traceResolution` shows the package's `.d.ts` resolving successfully -- the failure is
in the ambient-types resolution inside that `.d.ts`, not in finding the package.

Config-level fixes that all FAIL (do not waste time on these):
- `node-linker=hoisted` -- flat top-level, but entries are still symlinks to the store, same realpath, same failure.
- `public-hoist-pattern[]=@types/*` -- puts `@types/node` at the root but the store-realpath walk still misses it.
- pnpm `packageExtensions` injecting `@types/node` as a dep of the offending package -- injected but still not used for the `/// <reference>` resolution.
- `preserveSymlinks: true` -- fixes THIS package but breaks others (e.g. `@aws-sdk` `S3Client.send` goes missing); trades one failure for another.

## WRONG

```ts
// options interface extends the package's (now-degraded) bundled type,
// and the instance is passed straight to the API that wants that type
import Transport from 'winston-transport';

interface RedisTransportOptions extends Transport.TransportStreamOptions {
  getRedis: () => Promise<RedisClientType | null>;
}
class RedisLogTransport extends Transport { /* ... */ }

// tsc: RedisLogTransport is "missing writable, ... and 34 more";
//      `level` "does not exist in type 'RedisTransportOptions'"
logger.add(new RedisLogTransport({ level: 'info', getRedis }));
```

## RIGHT

```ts
// declare the options you actually pass (don't extend the degraded type),
// and cast at the single call site. Runtime is unaffected.
import Transport from 'winston-transport';

interface RedisTransportOptions {
  level?: string;
  getRedis: () => Promise<RedisClientType | null>;
}
class RedisLogTransport extends Transport { /* ... */ }

logger.add(
  new RedisLogTransport({ level: 'info', getRedis })
    as unknown as Parameters<typeof logger.add>[0]
);
```

## NOTES

- Reach for the local type shim, not a global pnpm setting -- only the one bad package needs
  it. pnpm's strict **isolated** linker is otherwise fine: Next.js standalone apps and
  everything else built cleanly; only this package's ancient bundled types tripped.
- The same class of failure will hit any dependency whose bundled `.d.ts` uses
  `/// <reference types="node" />` (or `import ... from 'stream'`) without declaring
  `@types/node`. The self-contained-interface + cast pattern generalizes.
- Keep peer strictness (`strict-peer-dependencies`) and the isolated linker; they surface
  real problems (this migration also caught a genuine phantom dependency). This gotcha is a
  narrow type-resolution artifact, not a reason to abandon strict pnpm.
- Observed on pnpm 11, TypeScript 6 with `moduleResolution: nodenext`, Node 24. Related:
  Next.js standalone builds are unaffected by this.
```
