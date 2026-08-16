---
tech: pnpm
tags: [pnpm, workspace, monorepo, ci, ignore-workspace, verify-deps-before-run, build]
severity: high
---
# `pnpm run` verifies deps against the workspace root, so `--ignore-workspace` on install does not scope the build

## PROBLEM

`--ignore-workspace` scopes `pnpm install`. It does **not** scope `pnpm run`.

Before running any script, pnpm 11 verifies that dependencies are installed
(`verify-deps-before-run`, on by default). That check resolves the nearest
`pnpm-workspace.yaml` **above the current directory** — not the package you are
standing in — and if the root's `node_modules` is missing, it installs every
workspace project first.

This bites a standalone nested package: a directory inside the repo with its own
`package.json` and its own lockfile that is deliberately *not* a member of the
root workspace. Installing it scoped works exactly as intended. Then the very
next line runs its build script, and pnpm quietly installs the entire monorepo —
dashboard, admin portal, everything — because that is what it found by walking
up.

Locally this usually succeeds and is invisible: the root `node_modules` already
exists, so the check passes and nothing prints. The cost is not usually that the
root install *fails* — it is that a job which had no reason to touch the rest of
the repo is now fully exposed to anything wrong with it.

That is what happened here. An unrelated defect had been committed at the
workspace root (a `dashboard/node_modules` symlink pointing into one developer's
home directory, which does not exist on a runner). The agent build never
referenced `dashboard` and had no business installing it — but the walk-up
dragged it in, and two signed-release builds died on a step named "Build
frontend", pointing nowhere near either the workspace or the real defect.

Both halves are worth fixing independently. Scoping the build stops unrelated
root breakage from reaching a job that does not need the root at all.

Three tells, all of which name the real behaviour:

* `Scope: all N workspace projects` — from a directory that is not in the workspace.
* Progress lines prefixed `../..` — pnpm reporting it left your directory.
* A stack of `runDepsStatusCheck` → `_install` → `tryFrozenInstall` → `headlessInstall` → `linkDirectDeps` → `linkDirectDepsOfProject`.

The misdirection is the error naming a workspace package the failing job never
referenced — here `ENOENT ... mkdir '<root>/dashboard/node_modules'` while
symlinking the root's `eslint`, in a job that builds a Svelte frontend. Read the
scope line first: if it says `all N workspace projects` from a directory that is
not one of them, the walk-up is what put you in front of that error, whatever
the error turns out to be.

## WRONG

```bash
cd desktop_agent_v2/frontend
# correctly scoped -- installs only this package's deps
pnpm install --ignore-workspace --frozen-lockfile
# NOT scoped: walks up, finds the root pnpm-workspace.yaml,
# and installs all 6 workspace projects before running vite
pnpm build
```

## RIGHT

```bash
cd desktop_agent_v2/frontend
pnpm install --ignore-workspace --frozen-lockfile
# the flag must PRECEDE the script name, or pnpm forwards it to the script
pnpm --config.verify-deps-before-run=false build
```

## NOTES

**Flag position is the whole fix, and getting it wrong looks like it worked.**
`pnpm build --config.verify-deps-before-run=false` does skip the dep check, then
passes the flag through to the script — vite receives it as an argument and dies
resolving its config (`paths[0] argument must be of type string`). You get a
green-looking change that fails differently. This is the same pass-through
behaviour as [`pnpm run <script> -- --flag` turns the flag into a positional
argument](run-flag-passthrough-double-dash.md); the two entries are the same
underlying rule seen from opposite ends.

**Three plausible fixes that do NOT work** (each verified against pnpm 11.15.1,
each leaving the root install firmly in place):

| Attempt | Result |
|---|---|
| `pnpm build --ignore-workspace` | forwarded to the script; dep check still runs |
| `npm_config_verify_deps_before_run=false pnpm build` | ignored; dep check still runs |
| `.npmrc` with `verify-deps-before-run=false` in the package dir | ignored; dep check still runs |

An `.npmrc` at the **workspace root** would apply, but that is the wrong lever
here: it disables the check for every package in the repo to fix one nested
non-member.

**Seeing it at all needs a clean checkout.** With a root `node_modules` already
present the check passes and prints nothing, so the walk-up never announces
itself — which is why this survives local testing and only shows up in CI. To
confirm the behaviour rather than the failure, clone fresh, install the nested
package scoped, run its build script, and then check whether a root
`node_modules` appeared. If it did, every job running that script is installing
the whole repo.

**Setting `CI=true` is not related but often shows up alongside**, because pnpm
refuses to purge a modules directory without a TTY
(`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`) and that error appears in the same
neighbourhood while debugging.
