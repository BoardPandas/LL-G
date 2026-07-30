---
tech: nodejs
tags: [fs, mtime, cache, invalidation, stat, stale-data, atomic-write]
severity: high
---
# A parent-directory mtime cache key never observes an edit to a file inside it

## PROBLEM

A directory mtime changes when an **entry is added, removed, or renamed in that directory**.
It does **not** change when the contents of a file already in it are modified, and it does
not change for anything happening in a subdirectory. So the tempting one-stat cache key —
`stat(ROOT).mtimeMs`, invalidating a whole scan of `ROOT/*/data.json` — silently misses
every ordinary edit.

It is a convincing mistake because it half-works, and the half that works is the half you
test first:

- creating a new item -> `ROOT` mtime moves -> cache rebuilds -> **looks correct**
- deleting an item -> `ROOT` mtime moves -> cache rebuilds -> **looks correct**
- editing an existing item -> `ROOT` mtime unchanged -> **cache serves the old value forever**

"Forever" is literal: nothing later reconciles it. The user archives a record and it keeps
appearing; they rename something and the old name persists until the process restarts or an
unrelated create/delete happens to bump the directory.

Atomic writes make it *more* wrong, not less. `writeJsonAtomic`-style helpers write a temp
file then `rename()` it over the target. The rename does bump a directory mtime — the
**file's own** directory (`ROOT/item/`), not `ROOT`. Verified on ext4:

```
ROOT/ mtime changed by a manifest edit?   false
item/ mtime changed by a manifest edit?   true
ROOT/ mtime changed by adding an item?    true
```

Codebases carrying this bug often look fine in review because a manual `bumpCache()` call
sits in one or two writers, hiding it for exactly those paths and no others.

## WRONG

```js
// One stat, whole-index invalidation. Misses every in-place edit.
let cached = null, cachedMtime = -1;

async function getIndex() {
  const mtime = (await stat(ROOT)).mtimeMs;   // <-- ROOT, not the files
  if (cached && cachedMtime === mtime) return cached;
  cached = await buildIndexByScanningEveryFile();
  cachedMtime = mtime;
  return cached;
}
// Edit ROOT/item-a/data.json -> ROOT's mtime is unchanged -> stale until a
// sibling directory is created or deleted. Adding `bumpCache()` to a couple of
// writers masks it for those callers and leaves every other writer broken.
```

## RIGHT

```js
// Key on each FILE's own mtime, and re-read only what actually changed.
const cache = new Map();   // key -> { mtimeMs, entry }
let refreshing = null;

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const dirs = await readdir(ROOT, { withFileTypes: true });
    const seen = new Set();
    await Promise.all(dirs.filter((d) => d.isDirectory()).map(async (dir) => {
      const p = join(ROOT, dir.name, "data.json");
      let mtimeMs;
      try { mtimeMs = (await stat(p)).mtimeMs; } catch { return; } // no file: not an item
      seen.add(dir.name);
      const hit = cache.get(dir.name);
      if (hit && hit.mtimeMs === mtimeMs) return;      // unchanged: keep it
      try {
        cache.set(dir.name, { mtimeMs, entry: project(JSON.parse(await readFile(p, "utf-8"))) });
      } catch {
        cache.delete(dir.name);   // corrupt: drop rather than serve the stale copy
      }
    }));
    for (const k of [...cache.keys()]) if (!seen.has(k)) cache.delete(k); // deletions
  })().finally(() => { refreshing = null; });
  return refreshing;
}
```

`stat()` on 370 files cost **1.5 ms** — a per-file key is not the expensive option, and it
catches creates, deletes, and edits with no manual bump calls anywhere.

## NOTES

- **Mutation-test the invalidation, or the test proves nothing.** Delete the
  `hit.mtimeMs === mtimeMs` comparison and re-run: if the suite still passes, it never
  covered staleness. Two tests should fail — "picks up an edit to an existing file" and
  "drops a file that became corrupt".
- Write the edit test so it genuinely reflects the trap: modify a file **in place** in an
  existing directory. A test that writes a brand-new directory passes under the broken
  parent-dir key too, because creating the directory bumps `ROOT`.
- **A manual `bump()` escape hatch is a smell, not a fix.** If invalidation needs writers to
  remember to call something, every writer added later is a latent staleness bug. Prefer a
  key that cannot be forgotten.
- mtime has ~1 ms granularity on many filesystems and second granularity on some (HFS+,
  older ext3). Two writes inside the same tick can collide; add `size`, or an `ino`+`ctime`
  pair, when correctness on rapid rewrites matters.
- Containers/network mounts: mtime comes from the writer's clock. Across NFS or a bind mount
  written by another host, clock skew can make a changed file look unchanged.
- Related: caching a directory scan at all is usually the fix for a parse-bound handler —
  see `async-fs-does-not-unblock-parse-bound-scan.md`, which is where this key is chosen.
