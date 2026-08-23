---
tech: pnpm
tags: [pnpm, update, lockfile, node_modules, store, hoisting, stale, false-green, testing, monorepo]
severity: high
---
# `pnpm update` leaves the old version resolvable, so the suite passes green against the package you just replaced

## PROBLEM

`pnpm -r update --latest <pkgs>` rewrites `package.json` and `pnpm-lock.yaml` correctly, but does **not** reliably prune the old versions out of `node_modules/.pnpm`, and does not always relink the hoisted fallback directory `node_modules/.pnpm/node_modules/`. The orphaned store entries stay on disk with **zero references in the lockfile**, and module resolution can still reach them.

The result is the worst possible failure shape: **the test suite passes**. It passes against the package you thought you had just replaced. Nothing warns you — not the install output, not the lockfile, not the manifests, all three of which are correct and agree with each other.

In the incident this came from, a 39-package upgrade moved `@tiptap/*` 3.27.3 → 3.30.2. The dashboard suite reported **1896/1896 passing**, which was read as "the tiptap major-ish bump is clean". It was not clean; it was never run. `node_modules/.pnpm` still held every `@tiptap+*@3.27.3` directory beside the new `@3.30.2` ones, and the workspace was still linked to the old set. A later unrelated `pnpm install` relinked things, and the *same commit* then failed:

```
RangeError: Can not convert <paragraph("Cores")> to a Fragment
(looks like multiple versions of prosemirror-model were loaded)
```

Two `prosemirror-model` copies were present (1.25.10 and 1.25.11) while the lockfile resolved exactly one. The give-away is that `grep -c "1\.25\.10" pnpm-lock.yaml` returned **0** — a version physically present in the store with no lockfile reference at all is an orphan, not a dependency.

Two things make this hard to land on:

- **`pnpm install --force` does not fix it.** It answers `Already up to date` and no-ops. The word "force" strongly implies a relink; it does not happen. (Same misleading response as the `npm install` contamination entry, different cause.)
- **`pnpm why <pkg>` does not show it.** It reads the lockfile, so it reports `Found 1 version` while two are on disk. It is describing intent, not the filesystem.

The blast radius is anything that resolves through the hoisted fallback — Jest especially, since its resolver differs from Node's and readily reaches `.pnpm/node_modules/`. A duplicated instance of a library with module-level identity checks (ProseMirror, React, GraphQL, Zod) then throws "multiple versions loaded" — but only *after* the tree is fixed. Before that, it silently tests the old code.

## WRONG

```bash
pnpm -r update --latest @tiptap/react @tiptap/pm @tiptap/starter-kit   # manifests + lockfile: correct
pnpm test                                                              # 1896/1896 pass
# ship it -- the upgrade is verified

# It is not verified. The suite ran against 3.27.3, which is still linked.
# And when it does break, --force will lie to you:
pnpm install --force        # "Already up to date" -- relinks nothing
pnpm why prosemirror-model  # "Found 1 version" -- reads the lockfile, not the disk
```

## RIGHT

```bash
pnpm -r update --latest @tiptap/react @tiptap/pm @tiptap/starter-kit

# Confirm the disk agrees with the lockfile BEFORE trusting any test result.
# Any version in the store with no lockfile reference is an orphan.
ls node_modules/.pnpm | grep -oE '^prosemirror-model@[0-9.]+' | sort -u
grep -oE 'prosemirror-model@[0-9.]+' pnpm-lock.yaml | sort -u
readlink node_modules/.pnpm/node_modules/prosemirror-model   # hoisted fallback

# If they disagree, --force will not help. Only a wipe + lockfile install will.
rm -rf node_modules */node_modules packages/*/node_modules
pnpm install --frozen-lockfile      # exactly what CI does
pnpm test                           # NOW the result means something
```

## NOTES

- **Rule of thumb: after any `pnpm update` that changes a version you intend to test, re-run the suite from a wiped `node_modules`.** A green run on a partially-relinked tree carries no information, and you cannot tell the two apart from the output.
- Tell it apart from the sibling entry [npm install in a pnpm repo leaves stale physical packages](npm-install-contaminates-pnpm-node-modules.md): that one is caused by running `npm` in a pnpm repo, leaves **physical directories** at the `node_modules` root, and surfaces as version-mismatch *errors*. This one is caused by `pnpm update` itself, leaves **symlinks** into orphaned `.pnpm` store dirs, and surfaces as a **false pass**. Both share the misleading `Already up to date`, and both are fixed only by a full wipe.
- Partial upgrades hide it best. If every workspace relinks, you get the new version everywhere and never notice; the damage comes when the root store updates and a workspace's links do not, which is exactly what a `-r` update across a subset of packages produces.
- A related smell in the same install: `Failed to create bin at <workspace>/node_modules/.bin/<tool>. ENOENT ... no such file or directory` naming a path under `.pnpm`. That is the linker reporting it could not complete, and it is worth treating as "the tree is now inconsistent" rather than as cosmetic noise.
- `--frozen-lockfile` is deliberate in the fix: it reproduces CI exactly, so a tree that installs clean locally is a tree CI can also build. A plain `pnpm install` may re-resolve and mask the very disagreement you are trying to observe.
