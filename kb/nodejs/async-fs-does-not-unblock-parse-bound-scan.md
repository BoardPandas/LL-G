---
tech: nodejs
tags: [fs, event-loop, json-parse, performance, blocking, cache, promises]
severity: high
---
# Switching a directory scan to node:fs/promises does not unblock the event loop when JSON.parse is half the cost

## PROBLEM

"No sync fs on a request path" is a near-universal lint rule and code-review reflex, so the
instinctive fix for a slow handler that walks a directory is to swap `readFileSync` for
`await readFile`. That converts the **I/O** wait, and nothing else. `JSON.parse` is
synchronous CPU work with no async variant, so on a parse-heavy scan the handler still
blocks the single-threaded event loop for most of its original duration.

The failure is invisible to the person who "fixed" it because the two obvious measurements
both look better:

- the endpoint's own latency drops (concurrent I/O beats serial I/O), and
- the code now passes the lint rule and reads as idiomatic async.

What does not improve is the thing that actually hurt: **every other request stalls behind
it**. And because the requester's own latency did improve, the fix gets shipped and the
report ("the app freezes when I open X") stays open.

Measured on a real handler scanning 370 JSON files totalling 128 MB, inside the deployed
container (Node 24):

```
readFileSync x370   152 ms     -> readFile async (concurrent): 92 ms
JSON.parse   x370   152 ms     -> unchanged, still blocking
existsSync   x370     1 ms     -> removable (the try/catch around the read covers ENOENT)
--------------------------
total               305 ms  of blocked event loop, per request
```

So async fs takes 305 ms -> ~152 ms. Half the stall remains, permanently.

The symptom to measure for is **cross-request latency**, not the endpoint's own. Fire the
expensive endpoint concurrently and time an unrelated trivial one:

```
/health alone                          117 ms
/health with 4 expensive calls in flight  1246 ms   <- 10.7x, this is the actual bug
```

After caching the parsed projection, that same pair read 112 ms / 118 ms.

## WRONG

```js
// "Fixed" the sync-fs lint finding. Still blocks the event loop for ~150 ms
// per request, because JSON.parse has no async form.
app.get("/api/things", async (c) => {
  const dirs = await readdir(ROOT, { withFileTypes: true });
  const manifests = await Promise.all(
    dirs.filter((d) => d.isDirectory())
        .map((d) => readFile(join(ROOT, d.name, "manifest.json"), "utf-8")),
  );
  // <-- 370 synchronous parses, one tick, nothing else runs
  return c.json(manifests.map((raw) => project(JSON.parse(raw))));
});
```

## RIGHT

```js
// Don't parse again. Cache the PROJECTION (small) rather than the parsed
// manifests (huge), and re-read only files whose own mtime moved.
const cache = new Map(); // dirName -> { mtimeMs, entry }
let refreshing = null;   // coalesce concurrent callers (LL-G async-singleton)

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const dirs = await readdir(ROOT, { withFileTypes: true });
    const seen = new Set();
    await Promise.all(dirs.filter((d) => d.isDirectory()).map(async (dir) => {
      const p = join(ROOT, dir.name, "manifest.json");
      let mtimeMs;
      try { mtimeMs = (await stat(p)).mtimeMs; } catch { return; }
      seen.add(dir.name);
      const hit = cache.get(dir.name);
      if (hit && hit.mtimeMs === mtimeMs) return;      // <-- the whole win
      try {
        cache.set(dir.name, { mtimeMs, entry: project(JSON.parse(await readFile(p, "utf-8"))) });
      } catch {
        cache.delete(dir.name); // corrupt: drop, never serve stale
      }
    }));
    for (const k of [...cache.keys()]) if (!seen.has(k)) cache.delete(k);
  })().finally(() => { refreshing = null; });
  return refreshing;
}

app.get("/api/things", async (c) => {
  await refresh();                       // warm: ~1.5 ms of stat() for 370 files
  return c.json([...cache.values()].map((r) => r.entry));
});
```

Result on the same handler: 305 ms -> **1.4 ms** warm, and the cross-request stall
disappeared entirely (1246 ms -> 118 ms).

## NOTES

- **Decide by measuring the split, not by reading the code.** Time `readFile` and
  `JSON.parse` separately over the real corpus before choosing a fix. If parse is a small
  fraction, async fs genuinely is the answer; if it is ~half, only caching is.
- **Cache the projection, not the raw parsed objects.** Caching the 128 MB of parsed
  manifests would have traded a CPU problem for a memory one. Caching only the fields the
  endpoint serves retained **11 MB**. Measure retained size with `--expose-gc` and an
  explicit `global.gc()` — the naive `heapUsed` read right after a big scan showed 290 MB,
  almost all of it uncollected parse garbage, which would have wrongly killed the design.
- `existsSync` before a read is redundant *and* a second syscall: the `try/catch` around
  the read already handles ENOENT.
- Store the in-flight refresh as the **promise** and clear it in `finally`, or a rejected
  refresh wedges the cache closed (see the async-singleton-race entry).
- The invalidation key is its own trap — keying on a parent directory's mtime does not
  observe edits to files inside it. See `parent-dir-mtime-misses-file-edits.md`.
- Ordering: populating the cache from `Promise.all` lands entries in **completion** order,
  not directory order. If the endpoint's output order is observable, record the `readdir`
  order separately and iterate that, or results reshuffle on every rebuild.
- This generalises past JSON: any sync CPU step in the loop (gzip, crypto, big regex,
  image decode) has the same shape.
