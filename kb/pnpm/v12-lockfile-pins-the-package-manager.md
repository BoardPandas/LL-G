---
tech: pnpm
tags: [pnpm, pnpm-12, lockfile, frozen-lockfile, packagemanager, corepack, ci, docker, upgrade, deploy]
severity: medium
---
# pnpm 12 records the package manager IN the lockfile, so bumping the pnpm pin without reinstalling breaks every `--frozen-lockfile` install

## PROBLEM

pnpm 12 added `packageManagerDependencies`. `pnpm-lock.yaml` is no longer one
YAML document -- it is now **two**, and the new FIRST document pins the package
manager itself: a `pnpm` entry matching `packageManager` in package.json, plus
all eight `@pnpm/exe.*` platform binaries (darwin/linux/win32 x x64/arm64, glibc
and musl).

That couples the lockfile to a field in a completely different file. Bump the
pnpm pin -- in package.json, a Dockerfile, a `corepack prepare` line in CI --
without re-running `pnpm install`, and every frozen install dies:

```
Error: ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE

  x resolve package manager dependencies
  \-> Cannot update packageManagerDependencies with "frozen-lockfile" because
      the lockfile is not up to date
```

**Why it is worse than it looks: the failure is invisible where you are
working.** A plain `pnpm install` on your machine does not fail -- it quietly
rewrites the lockfile's first document and reports success. `--frozen-lockfile`
is what CI runs and what every Docker build stage runs, so the first thing that
breaks is the deploy, from a commit that was green locally.

The error also names `packageManagerDependencies`, a concept that did not exist
in pnpm 11 and appears in nothing you edited, so it does not obviously point
back at the one-line version bump that caused it. The instinct is to go hunting
for dependency drift; there is none.

This fires on the 11 -> 12 upgrade itself, and again on every subsequent pnpm
patch bump.

## WRONG

```dockerfile
# Dockerfile -- bump the pin, ship it. Lockfile untouched.
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
RUN pnpm install --frozen-lockfile   # ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE
```

```bash
# The commit that produces it. Green locally, red on the deploy gate.
sed -i 's/pnpm@11.24.0/pnpm@12.3.4/' package.json Dockerfile .github/workflows/*.yml
pnpm run test && pnpm run build   # all pass: neither uses --frozen-lockfile
git commit -am 'chore(deps): bump pnpm'
```

## RIGHT

```bash
# Bump the pin at EVERY site, then regenerate the lockfile in the SAME commit.
sed -i 's/pnpm@11.24.0/pnpm@12.3.4/' package.json Dockerfile .github/workflows/*.yml
pnpm install                        # rewrites the packageManagerDependencies document

# Verify the shape CI and Docker actually run, not just the local one:
pnpm install --frozen-lockfile      # must exit 0 before you commit

git add package.json pnpm-lock.yaml Dockerfile .github/workflows
git commit -m 'chore(deps): bump pnpm, regenerate lockfile'
```

Grep for stragglers before regenerating -- the pin is usually in more places
than you remember (root manifest, every Dockerfile stage, every workflow that
runs `corepack prepare`):

```bash
grep -rn 'pnpm@[0-9]' --include='*' . | grep -v node_modules | grep -v pnpm-lock
```

## NOTES

- **The diff is only the new document.** On a clean 11 -> 12 bump nothing
  resolves differently: the dependency graph is byte-identical and the lockfile
  grows by ~100 lines, all of them the package-manager document. A large diff
  here means something else moved -- read it.
- **`pnpm-lock.yaml` is now multi-document YAML.** Any tooling that parses it
  with a single-document load (`yaml.safe_load`, `YAML.parse`) sees only the
  package-manager document and concludes the project has no dependencies. Use a
  multi-document loader (`load_all` / `parseAllDocuments`), or keep to
  path-based checks.
- **The `@pnpm/exe.*` entries are recorded but NOT materialised** into
  node_modules while corepack supplies pnpm (verified on 12.3.4, including
  `--prod` and `--filter <pkg>...` installs). This matters on hosts without
  `libatomic.so.1` -- the native `@pnpm/exe` binary needs it, which is why
  `pnpm/action-setup` with `standalone: true` fails on a bare Fedora runner
  (exit 127). The lockfile entries alone do not reintroduce that dependency.
- **pnpm 12 also errors on unrecognised `pnpm-workspace.yaml` settings** rather
  than ignoring them. `allowBuilds`, `verifyDepsBeforeRun`,
  `minimumReleaseAgeExclude` and `overrides` all survive the 11 -> 12 jump
  unchanged, but a setting you misspelled in the pnpm 11 era has been silently
  doing nothing and will now fail the install. Read the errors as a free audit.
- Distinct from
  [`update-leaves-stale-store-false-green.md`](update-leaves-stale-store-false-green.md):
  that one is a false GREEN from stale symlinks. This one is a loud RED, but
  only in CI and Docker -- never on the machine where the change was made.
- Related: [`v11-overrides-workspace-yaml-and-ranges.md`](v11-overrides-workspace-yaml-and-ranges.md)
  for the previous major's config-location break.
