---
tech: pnpm
tags: [pnpm, npm, node_modules, contamination, version-mismatch, jest, monorepo, symlinks]
severity: high
---
# npm install in a pnpm repo leaves stale physical packages that shadow pnpm's versions

## PROBLEM
Running `npm install` (or an `npx` invocation that installs) in a pnpm-managed repo physically materializes packages at the root of `node_modules` alongside pnpm's symlinks. The stale physical copies shadow pnpm's resolved versions in Node's module resolution and survive every subsequent `pnpm install`, which reports "Already up to date" because the lockfile and virtual store (`node_modules/.pnpm`) are fine.

Nothing fails at contamination time. The failure surfaces much later, when a dependency bump makes the pinned pnpm version and the stale physical copy incompatible, and it fails in a way that looks like an upstream bug in the package itself.

Real case (supportforge-platform, 2026-07): every jest suite failed with `TypeError: this._moduleMocker.clearMocksOnScope is not a function`. `jest-runtime@30.4.2` was correctly loaded from the pnpm store, but the `ModuleMocker` came from a physical `jest-mock@30.2.0` sitting at the `node_modules` root from an old npm install, shadowing pnpm's `jest-mock@30.4.1`. The repo had 746 stale physical packages in total. Checking versions inside `node_modules/.pnpm/...` shows everything correct, which makes the mismatch maddening to diagnose: the broken copy is only visible at the hoisted root.

## WRONG
```bash
# In a pnpm repo (pnpm-lock.yaml present):
npm install            # materializes physical packages over pnpm's symlinks
npm install some-pkg   # same problem

# Later, trying to fix a weird version-mismatch error:
pnpm install           # "Already up to date" -- does NOT remove the stale physical copies
pnpm update jest-mock  # updates the virtual store, stale root copy still shadows it
```

## RIGHT
```bash
# Diagnose: physical directories at the node_modules root = contamination.
# (pnpm's hoisted entries are symlinks/junctions; isSymbolicLink() is true for both.)
node -e "
const fs=require('fs');
const phys=fs.readdirSync('node_modules').filter(d=>!d.startsWith('.'))
  .flatMap(d=>d.startsWith('@')?fs.readdirSync('node_modules/'+d).map(s=>d+'/'+s):[d])
  .filter(p=>!fs.lstatSync('node_modules/'+p).isSymbolicLink());
console.log(phys.length+' physical packages'); console.log(phys.slice(0,20).join('\n'));
"

# Fix: wipe node_modules in EVERY workspace package, then reinstall with pnpm.
rm -rf node_modules packages/*/node_modules apps/*/node_modules
pnpm install

# Prevent: only ever use pnpm in pnpm repos.
```

## NOTES
- Surgically deleting the one shadowing package appears to work but usually more contamination remains (746 packages in the observed case). Always do the full wipe.
- Tell: npm printing `npm warn Unknown project config "strict-peer-dependencies"` (or `"auto-install-peers"`) means npm is reading a pnpm `.npmrc` -- someone is running npm against a pnpm repo. Treat that warning as a red flag, including from `npx`.
- To pin which copy is actually loaded, resolve from the failing package's own directory, e.g. `require('./node_modules/<pkg>/package.json').version` at the root vs inside `node_modules/.pnpm/...` -- if the root copy is physical and older, that is the one winning resolution.
- Related: [Packages with legacy bundled types fail tsc under pnpm + nodenext](legacy-package-types-nodenext.md) -- a different class of pnpm symlink-layout surprise.
