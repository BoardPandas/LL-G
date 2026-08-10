---
tech: nodejs
tags: [concurrency, mutex, deadlock, middleware, async, locks, hono, express, testing]
severity: high
---
# A per-key mutex held by middleware deadlocks any handler that re-acquires it, and poisons that key forever

## PROBLEM

The "serialize all writes per resource" pattern is usually implemented as middleware that wraps the whole downstream chain in a per-key async mutex: `withLock(key, () => next())`. That is correct, and it is also invisible from inside a handler. A handler author who wants a consistent read-modify-write reaches for the same helper, and now the lock is acquired twice in one request.

The nested acquisition waits for the middleware's turn to release. The middleware's turn cannot release until `next()` returns, i.e. until the handler returns. Neither can proceed.

Four properties make this far worse than a normal deadlock, and each one points the investigation away from the cause:

1. **It never errors.** Typical mutex implementations bound only the *cross-process* stage (a file lock with retries, throwing `ELOCKED` and mapped to a 503). The *in-memory* FIFO stage is a plain `await prev` with no timeout. So the request hangs until the client gives up rather than failing.
2. **It is permanent, not transient.** The deadlocked request never releases its slot in the key's queue, so every subsequent request for that key waits behind it forever. One bad request takes the resource out of service until the process restarts.
3. **Reads stay fast.** The middleware skips `GET`/`HEAD`, so the resource reads perfectly while nothing can be written to it. That reads as data corruption, not as a lock bug.
4. **The lock sits upstream of routing and auth.** A request to a route that does not exist hangs. A request with no credentials hangs. So the symptom does not point at the handler that actually contains the bug.

It also survives the obvious test. Route tests usually mount the handler on a bare app and skip the middleware, so the handler's acquisition is uncontended and the whole suite passes while production deadlocks.

## WRONG

```ts
// routes/index.ts -- every mutating request already holds the lock
app.use("/items/:id/*", async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") return next();
  return await withKeyLock(c.req.param("id"), () => next());
});

// routes/item-patch.ts -- and the handler takes it AGAIN
app.patch("/items/:id", async (c) => {
  const id = c.req.param("id");
  // Deadlock: waits on the middleware's turn, which waits on this handler.
  // Hangs forever, and every later write to `id` queues behind it.
  const result = await withKeyLock(id, async () => {
    const fresh = JSON.parse(readFileSync(path, "utf8"));
    fresh.name = (await c.req.json()).name;
    writeJsonAtomic(path, fresh);
    return fresh;
  });
  return c.json(result);
});

// The test that "covers" it -- and never mounts the middleware
const app = new Hono();
registerItemRoutes(app);          // uncontended lock; passes; proves nothing
```

```ts
// The unbounded stage, for reference: only the file lock is bounded.
const prev = locks.get(key) ?? Promise.resolve();
locks.set(key, prev.then(() => next));
await prev;                                   // <-- NO timeout. Waits forever.
fileRelease = await lockFile(p, { retries: 15, stale: 10_000 });  // bounded -> ELOCKED
```

## RIGHT

```ts
// Export the middleware from its own module so tests mount the REAL one,
// and document the invariant where a handler author will actually read it.
/**
 * INVARIANT: a handler reached through this middleware ALREADY HOLDS the
 * lock for `id`. Do not call withKeyLock(id) again -- the nested acquisition
 * waits on this middleware's turn, which cannot release until your handler
 * returns. Write directly. Re-reading from disk first is still correct: the
 * lock is held for the whole request, so a fresh read sees any background
 * job that landed while the request was queued.
 */
export const serializeMutations: MiddlewareHandler = async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  return await withKeyLock(c.req.param("id"), () => next());
};

// The handler writes directly. No second acquisition.
app.patch("/items/:id", async (c) => {
  const fresh = JSON.parse(readFileSync(path, "utf8"));   // lock already held
  fresh.name = (await c.req.json()).name;
  writeJsonAtomic(path, fresh);
  return c.json(fresh);
});

// The test mounts the real middleware, so a nested lock actually deadlocks here.
const app = new Hono();
app.use("/items/:id/*", serializeMutations);   // imported, never re-implemented
registerItemRoutes(app);

it("completes while the lock is held, and leaves the key writable", async () => {
  // Race a timer: a regression fails in 5s instead of hanging the suite.
  const first = await Promise.race([
    patch("x", { name: "a" }),
    new Promise((r) => setTimeout(() => r("deadlocked"), 5_000)),
  ]);
  expect(first).not.toBe("deadlocked");
  // A deadlocked request never yields its queue slot, so prove the chain drains.
  const second = await Promise.race([
    patch("x", { name: "b" }),
    new Promise((r) => setTimeout(() => r("deadlocked"), 5_000)),
  ]);
  expect(second).not.toBe("deadlocked");
});
```

## NOTES

**Diagnose it with three requests, no logs required.** Against the wedged key:

- a mutating request to a **route that does not exist** -> hangs means the stall is in middleware, not your handler
- the same request with **no auth at all** -> hangs means it is upstream of auth
- a `GET` -> fast means reads skip the lock

Any lock-free explanation (body size, `Expect: 100-continue`, transport, the handler's own logic) dies on the first two.

**The legitimate re-acquisition is a background runner.** A fire-and-forget job enqueued by a handler runs *after* the response, by which time the middleware has released, so it must take the lock. That is why a codebase can contain several correct-looking nested calls and exactly one fatal one: check whether the call executes inside the request chain or after it.

**Forensics for a live wedge.** `proper-lockfile` and similar advisory locks refresh their lock directory's mtime at `stale/2` while held. An mtime advancing every few seconds proves a *live* holder and means the `stale` timeout can never fire; a frozen mtime is the opposite (an abandoned lock that will be broken automatically). The lock directory's birth time dates the wedge, and a client-side timeout minus its own budget (e.g. undici's `UND_ERR_HEADERS_TIMEOUT` at 300s) pins it to one identifiable request.

**Two inferences that reliably mislead here:**

- *"It survives restarts, so it cannot be in-memory state."* In-memory state does not survive a restart. What survives is the client (or a retry loop) re-sending the same request and re-wedging the key within minutes. Compare the lock's birth time against the process start time before concluding otherwise.
- *"A second route hangs too, so the cause is broader / pre-existing."* Once a key's queue is poisoned, *every* mutating request for that key hangs, including correct handlers. Symptom breadth says nothing about cause breadth.

**Design fix if you own the mutex:** either make it re-entrant per request (`AsyncLocalStorage`, but verify the context does not leak into deferred runners, which would silently drop real exclusivity), or have the in-memory stage throw on nested acquisition of a key already held in the current request. A loud failure is strictly better than an unbounded wait. Do not add a blanket timeout to the queue -- legitimate long holders (media generation, batch renders) are supposed to make others wait.

Related: LL-G `nodejs/leaked-exit-timer-masks-test-hang.md` and `nodejs/unregistered-kickoff-timer-survives-shutdown.md` share the shape "green test suite, wrong runtime behavior, because the harness omits the production wiring".
