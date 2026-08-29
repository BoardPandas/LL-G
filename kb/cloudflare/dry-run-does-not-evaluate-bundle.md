---
tech: cloudflare
tags: [wrangler, workers, esbuild, bundling, ci, deploy, dry-run, module-initialization, zod, vitest]
severity: high
---
# `wrangler deploy --dry-run` never evaluates the bundle, so a dead worker passes every local gate

## PROBLEM

`wrangler deploy --dry-run --outdir dist` **bundles** the worker. It does not **run** it.

The real deploy does. Cloudflare executes the module's top level as an upload-time
validation step, and rejects the version if that throws. So any error in module-scope code
— a `TypeError` from an initialisation-order break, a bad top-level `await`, a constructor
that is still `undefined` — is invisible to every check you run locally and fails only at
the moment you ship.

The green board is the whole problem. On the run that produced this entry:

```
Typecheck, lint, test, bundle: success     <- pnpm build passes: it only bundles
Repo guards:                   success
Workers Builds: broadside-mcp: FAILURE     <- the only red thing, and it is the deploy
```

with, in the build log:

```
✘ [ERROR] A request to the Cloudflare API (/accounts/<id>/workers/scripts/<name>/versions) failed.
  Uncaught TypeError: ZodLazy is not a constructor
    at .../zod@4.4.3/v4/classic/schemas.js:1295 in lazy
    at .../@modelcontextprotocol/core/src/schemas.ts:6   [code: 10021]
```

**The test suite does not save you, and for a non-obvious reason.** Under
`@cloudflare/vitest-pool-workers` the tests really do evaluate the entry module inside
`workerd` — but Vitest bundles it with Vite/Rolldown, a *different bundler* from the
esbuild that `wrangler deploy` uses. The two produce different module ordering, so the
suite can import the worker perfectly while the artifact that actually ships is dead on
arrival. 488 tests passed against a bundle that could not start.

**What triggers it.** esbuild wraps some modules in a lazy `__esm(() => {...})` initialiser
and emits others as eager top-level code. If an eager module calls into a lazy one before
its initialiser has run, you get `X is not a constructor` / `undefined`. Here
`@modelcontextprotocol/core` calls `z.lazy()` at module scope (eager) while zod's classic
schemas — which is where `ZodLazy` is assigned — landed in a lazy wrapper. Adding one more
dependency to the bundle (`better-auth`, pulled in by `@better-auth/oauth-provider`)
reordered the graph enough to put the eager call first. Nothing in the dependency's own
version changed; the *set* of things in the bundle did.

**Why it is easy to leave broken.** A rejected version is not an outage: the worker keeps
serving its previous build, so no alarm fires and nothing looks down. But no further change
can reach that worker until it is fixed, and the next person to push inherits a red deploy
they did not cause.

## WRONG

```yaml
# CI that proves the worker compiles and bundles, and nothing about whether it RUNS.
- run: pnpm typecheck
- run: pnpm lint
- run: pnpm test          # vitest bundles with Vite, NOT with wrangler's esbuild
- run: pnpm build         # wrangler deploy --dry-run --outdir dist -- bundles only
# Ships. Cloudflare evaluates the module, throws, and refuses the version.
```

Four fixes that look obvious and are not — each was tested on the failure above:

```bash
# 1. Downgrade the dependency you just bumped. Still throws: the trigger is the SET of
#    modules in the bundle, not any one version.
# 2. Downgrade the dependency that pulled the new code in. Often impossible anyway --
#    here the older release imported a symbol the new peer had removed.
# 3. Bump the lazily-initialised package. Frequently peer-pinned by something else
#    (zod was held at 4.4.3 by the MCP SDK), so the lever does not exist.
# 4. `import "zod";` as the first line of the entry module. Does NOTHING: esbuild emits a
#    module's dependencies before the module itself, so the eager offender runs before any
#    statement in your entry file. You cannot fix ordering from inside the entry.
```

## RIGHT

Evaluate the built artifact. One line, and it is the only check that reproduces what
Cloudflare does at upload:

```bash
pnpm build   # wrangler deploy --dry-run --outdir dist
node --input-type=module -e "await import('$PWD/dist/index.js')"
# exits 0 = the module initialises = upload validation will pass
# exits 1 = the deploy WILL be rejected, with the same error, before you push
```

As a CI step, after the bundle:

```yaml
- run: pnpm build
# Asserts on the built artifact, so it must run after it. Placed after typecheck/lint/test
# so a failure here never skips the suite.
- run: pnpm check:bundle-order
```

And remove the coupling if you can. The real fix in this case was not reordering the
bundle but noticing that a *resource server* had no business importing an
*authorization server* package to verify one JWT. Dropping `better-auth` from that worker
in favour of `jose` (already a dependency) removed the offending module from the graph
entirely and took 171 KiB off the bundle. A bundler-ordering workaround is a patch on
coupling you may not need.

## NOTES

- **The dry run is still worth keeping.** It catches unresolved imports, missing bindings
  and config errors. It simply cannot catch anything that only manifests when the module
  is evaluated. Treat "bundles" and "starts" as two separate claims.
- **Importing under Node is a proxy, not a replica.** Node is not `workerd`: a worker whose
  module scope touches a Workers-only global will throw there for an unrelated reason. In
  practice module-scope code is imports and constants, so this is rare — but if it bites,
  the honest fix is to evaluate under `workerd` rather than to drop the check. The failure
  class that matters (initialisation order inside the bundle) reproduces identically in
  Node, because it is plain JavaScript evaluation order.
- **Check every worker, not just the one that broke.** The trigger is the dependency set,
  so the next reordering will land somewhere else in a monorepo.
- **Reading the bundle to confirm the diagnosis:** find where the symbol is assigned versus
  where it is used. `grep -n "^var init_[a-z]* = __esm" dist/index.js` lists the lazy
  initialisers; if the throwing call site sits outside any of them and no `init_x()` call
  precedes it, that is the ordering break, not a version mismatch. Chasing it as a version
  problem is what costs the time.
- Related: [unapplied-migration-silent-failure.md](unapplied-migration-silent-failure.md)
  is the same shape one layer down — a gate that reports success without having checked the
  thing that actually has to be true in production.
