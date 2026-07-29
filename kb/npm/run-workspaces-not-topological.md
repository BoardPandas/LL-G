---
tech: npm
tags: [npm, workspaces, monorepo, build-order, ci, gitignore, false-green]
severity: high
---
# `npm run <script> --workspaces` runs alphabetically, not in dependency order

## PROBLEM

npm topologically sorts **installs**, but not **script runs**. `npm run build --workspaces`
executes each workspace in the order the workspaces resolve -- effectively alphabetical by
directory -- with no regard for the dependency graph between them.

In a monorepo where one workspace imports another's build output, the consumer can therefore
build before its dependencies exist, and the build fails on an unresolvable import of a
package that is sitting right there in the same repo.

What makes this hard to debug is that it is **invisible locally**. Build output directories
(`dist/`, `.next/`) are gitignored, so they persist on a developer machine from earlier runs.
Every local `npm run build` reads those stale artifacts and passes. The failure only appears
where the tree is clean: CI, a fresh clone, a Docker build, or after a prune. The result is a
false green -- you verify the build, see it pass, and push something that cannot build.

It can lie dormant indefinitely. A repo whose production image builds via a Dockerfile with
its own explicit ordering will deploy fine for months while the root `build` script has never
once worked from a clean checkout. It surfaces the first time anything builds the repo the
documented way.

## WRONG

```json
{
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build --workspaces"
  }
}
```

With `packages/` holding `graph-mcp`, `mcp-bridge`, `meraki-mcp`, `unifi-mcp`, npm runs
`mcp-bridge` second -- before the packages it imports have emitted `dist/`:

```
> @scope/mcp-bridge build
> next build

Module not found: Can't resolve '@scope/unifi-mcp/server'
Module not found: Can't resolve '@scope/meraki-mcp/server'
> Build failed because of webpack errors
```

## RIGHT

Order the stages explicitly: dependencies first, consumers last.

```json
{
  "workspaces": ["packages/*"],
  "scripts": {
    "build:libs": "npm run build -w packages/graph-mcp -w packages/meraki-mcp -w packages/unifi-mcp",
    "build:bridge": "npm run build -w packages/mcp-bridge",
    "build": "npm run build:libs && npm run build:bridge"
  }
}
```

Verify on a genuinely clean tree, or the check is worthless:

```bash
rm -rf packages/*/dist packages/*/.next packages/*/tsconfig.tsbuildinfo
npm run build
```

## NOTES

- **A local build passing proves nothing here.** Any machine that has built before carries
  the artifacts that hide the bug. Clean the tree first, or trust only CI.
- npm has **no `--exclude-workspace` flag**, so the dependency list in `build:libs` must be
  written out. Adding a package means editing it -- annoying, but explicit and correct.
- If a Dockerfile in the repo already builds in a working order, **mirror that order** rather
  than deriving a new one. It is the ordering already proven in production.
- pnpm's recursive run (`pnpm -r run build`) **is** topologically ordered by default, so a
  monorepo ported from pnpm to npm inherits this bug silently -- the script looks equivalent
  and the ordering guarantee quietly disappears.
- The same trap applies to `npm run test --workspaces` whenever tests import a sibling's
  build output rather than its source.
