---
tech: pnpm
tags: [pnpm, worktree, symlink, node_modules, verify-deps-before-run, modules-yaml, hoisting]
severity: high
---
# `pnpm run` in a symlink-farm worktree installs through the links into the source checkout

## PROBLEM
A common way to run tools in a fresh git worktree without a full install is a
"symlink farm": a real `node_modules/` directory whose entries (including
`.pnpm`, `.bin`, `.modules.yaml`) are symlinks into another checkout's install.

pnpm 11/12 verifies deps before every `pnpm run` / `pnpm --filter ... <script>`.
When the worktree's lockfile differs from the source checkout's install (for
example the worktree is on a branch with an older lockfile), that check runs a
silent install, and the install writes THROUGH the symlinks into the source
checkout:

- the source's hoisted `node_modules/.pnpm/node_modules/*` links are repointed
  to the worktree lockfile's versions (seen: `@better-auth/core` 1.7.5 -> 1.7.2)
- the source's `node_modules/.modules.yaml` is rewritten to describe the
  worktree's lockfile
- extra package dirs appear in the source's `.pnpm` store
- the worktree gains real `<workspace-pkg>/node_modules` dirs

Nothing errors. The script you ran succeeds. The other checkout now quietly
resolves phantom/hoisted deps to the wrong versions, and its next `pnpm`
command sees a node_modules state that does not match its own lockfile.


A symlink for the entire `node_modules` directory has the same hazard. On pnpm
12.5.1, `pnpm exec jest` in a worktree with a different lockfile also triggered
installation through that link. Do not assume `exec` is read-only. This caused
runtime contract exports to disappear in route tests even though the source
exports existed; the other checkout's dependency tree had been reconfigured.

## WRONG
```bash
# worktree with a node_modules symlink farm pointing at ../other-checkout
pnpm --filter @scope/contracts build
pnpm run check:all        # silently installs into ../other-checkout
```

## RIGHT
For different lockfiles, give each checkout its own dependency tree. The pnpm
content-addressed cache may be shared; the mutable `node_modules` trees may not.
In the worktree you own, remove only the whole-directory symlink after checking
it is a symlink, then install that checkout's frozen lockfile:
```bash
python3 - <<'PYTHON'
from pathlib import Path
p = Path('node_modules')
assert p.is_symlink(), 'Refuse to remove an ordinary directory'
p.unlink()
PYTHON
pnpm install --offline --frozen-lockfile
pnpm --filter @scope/contracts build
```
Use the direct-binary workaround below only when the dependency tree actually
matches the tested checkout. Avoiding reinstallation does not make mismatched
package versions a valid release test.

```bash
# in a symlink-farm worktree, call binaries directly -- never pnpm
node node_modules/typescript/bin/tsc --noEmit
node_modules/.bin/jest src/__tests__/foo.test.ts
node_modules/.bin/eslint src/foo.ts
(cd packages/contracts && node ../../node_modules/typescript/bin/tsc -p tsconfig.json)
```

Repair if it already happened (only when the source checkout is idle):
```bash
cd ../other-checkout
pnpm install --frozen-lockfile --offline
find node_modules node_modules/.pnpm/node_modules */node_modules -maxdepth 2 \
  -type l ! -exec test -e {} \; -print   # expect no output
```

## NOTES
- Tells: `.modules.yaml` in the source checkout has an mtime from your
  worktree session; `readlink node_modules/.pnpm/node_modules/<pkg>` points at a
  version absent from that checkout's lockfile; new real `admin/`, `dashboard/`
  etc. `node_modules` dirs in the worktree.
- `pnpm --config.verify-deps-before-run=false <script>` also avoids it, but the
  script's own nested `pnpm` calls still trigger the check -- direct binaries are
  the reliable rule.
- When tearing the farm down, unlink symlinks without following them (e.g.
  Python `os.walk(followlinks=False)` + `os.unlink`); `rm -rf` through a
  symlinked store can be refused by permission layers that resolve the link.
- Related: run-verifies-deps-against-workspace-root.md,
  update-leaves-stale-store-false-green.md.
