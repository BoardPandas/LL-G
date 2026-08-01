---
tech: nodejs
tags: [fallback, resilience, retry, degradation, connection-pool, batch, cache, observability, fetch]
severity: high
---
# A fallback that routes back through the failing dependency turns a blip into an outage

## PROBLEM

The "fast path with a graceful fallback" shape looks like resilience and is often the
opposite. Two independent defects hide inside it, and they compound:

**1. The fallback is not independent.** A batched call to an internal service falls back
to per-item calls against *that same service*. When the service is the thing that failed,
the fallback is a second wave of load on it — an amplifier, not a mitigation. It only
reads as a fallback because the two paths have different URLs.

**2. An empty container conflates "outage" with "genuinely nothing."** `map.size === 0`
is produced BOTH by a failed request and by a successful request that matched no rows.
Inferring which happened from the count picks the wrong recovery, and the wrong one is
usually the dangerous one.

Measured (2026-08-01, a card-import service): the API's `pg` pool was capped at `max: 10`
while a single import fanned out past that on its own (8 concurrent search queries, 4
prompt lookups, the batch, plus normal traffic). Starved requests exceeded
`connectionTimeoutMillis` and threw; the framework turned that into HTTP 500. The batch
helper had **one attempt per chunk**, read the 500 as "no cards found," returned an empty
map, and dropped all 22 names onto the per-item path — which hit the same exhausted pool
and also failed.

The logs pinned it to the millisecond:

```
03:29:50.161  Error: timeout exceeded when trying to connect   (pg-pool, api)
03:29:50.162  [batch-resolve] chunk HTTP 500 (22 names)        <- same millisecond
03:32:03      API error for "Guardian Project": aborted due to timeout
```

Why it is HIGH and not merely slow: the import **persisted records with no data attached**.
19 of 22 rows were written missing their enrichment — including extremely common values
that had been in the database the whole time. Downstream aggregates join on that data and
silently drop the empty rows, so the corruption reads as a slightly smaller result set, not
as an error. The user-visible symptom was "imports are slow today."

The trap on the repair: the obvious fix — "the fallback is too slow, raise its
concurrency" — makes the outage worse, because it is more load on the failed dependency.
And if the fallback's later stages reach an *external* rate-limited API, fanning out on a
genuine no-match burns the very pacing that prevents HTTP 429s.

## WRONG

```ts
// Fast path + "graceful" fallback. Both paths hit the SAME service.
const map = await batchResolve(names); // POST /api/cards/batch -> api service
//  ^ one attempt; a transient 500 returns an empty map indistinguishable from "no rows"

const misses = names.filter((n) => !map.has(n));

// Inferring the cause from the COUNT, not from what actually happened:
const outage = map.size === 0 && names.length >= 12;

for (const n of misses) {
  await lookupOne(n); // GET /api/search -> the SAME api service that just failed
  if (!outage) await sleep(100);
}
// Outage  -> every name stampedes the dependency that is already down.
// No-match-> the fan-out bursts an EXTERNAL rate-limited API and earns 429s.
```

```ts
// The empty container that started it all -- the failure is thrown away here.
async function batchResolve(names: string[]): Promise<Map<string, Row>> {
  const out = new Map<string, Row>();
  const res = await fetch(endpoint, { method: "POST", body: JSON.stringify({ names }) });
  if (!res.ok) {
    console.warn(`chunk HTTP ${res.status}`); // server-side only; never reaches the caller
    return out; // <- "no rows" and "the service is down" are now the same value
  }
  for (const row of (await res.json()).data) out.set(row.name.toLowerCase(), row);
  return out;
}
```

## RIGHT

```ts
// 1. Retry the fast path before abandoning it. A transient 5xx is not a verdict.
//    Bound the attempts: each one can burn the full timeout, so a high count turns a
//    genuinely-down dependency into a long dead wait before recovery even starts.
const BATCH_ATTEMPTS = 2;

async function fetchChunk(names: string[]): Promise<{ rows: Row[]; ok: boolean }> {
  for (let attempt = 1; attempt <= BATCH_ATTEMPTS; attempt++) {
    const last = attempt === BATCH_ATTEMPTS;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        body: JSON.stringify({ names }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return { rows: (await res.json()).data ?? [], ok: true };

      // 5xx/429 are transient (saturated pool, restart, rate limit).
      // A 4xx is OUR malformed request -- retrying re-earns the same rejection.
      const retryable = res.status >= 500 || res.status === 429;
      if (!retryable || last) return { rows: [], ok: false };
    } catch {
      if (last) return { rows: [], ok: false };
    }
    await sleep(500);
  }
  return { rows: [], ok: false };
}

// 2. Return the TRANSPORT OUTCOME beside the data. Never make the caller guess
//    "outage vs nothing found" from the size of a container.
export interface BatchResult {
  map: Map<string, Row>;
  /** A chunk never got a successful response. NOT "the map is empty". */
  degraded: boolean;
}
```

```ts
// 3. Choose the fallback SHAPE from that signal, and say the outage out loud.
const { map, degraded } = await batchResolve(names);
const misses = names.filter((n) => !map.has(n));

if (degraded) {
  console.warn(
    `[import] the batch fast path FAILED for ${names.length} name(s) ` +
      `(${misses.length} unresolved) -- falling back to per-item lookups`,
  );
}

// Fan out ONLY on a real outage, where the misses are ordinary items the service
// will answer once it recovers. A batch that merely found nothing means the items
// are genuinely absent, and those reach the EXTERNAL rate-limited API downstream --
// the pacing is the only thing keeping that under the limit.
const concurrency = degraded && misses.length >= 12 ? 8 : 1;

// 4. Make the degradation visible to the CALLER, not just to the log file.
return { ...result, batchResolved: names.length - misses.length, batchMissed: misses.length };
```

```ts
// 5. Size the shared resource for real peak concurrency, and count your OWN fan-out.
//    One import issued >10 concurrent queries by itself against a max:10 pool.
const pool = new Pool({
  max: 24, // 24 here + 8 in the other service's pool = 32 of Postgres' 100
  connectionTimeoutMillis: 10_000,
});
```

## NOTES

- **The diagnostic tell.** A dependency-exhaustion error and the consumer's
  "graceful degradation" land in the same millisecond. Grepping both services' logs on a
  shared timeline is what separates "the fast path is misconfigured" from "the fast path
  was refused." Here the consumer's warning already existed and had logged the exact
  cause — nobody had read it, because nothing surfaced it to the caller.
- **Audit your own concurrency before blaming traffic.** The import was its own thundering
  herd: 8 + 4 + 1 concurrent queries from a single user action against a 10-connection
  pool. Peak concurrency is not "number of users."
- **A stated hypothesis is a lead, not a finding.** This was reported as "the env var that
  enables the fast path must be unset." It was set correctly in every layer. Two read-only
  checks falsified it in one round-trip; setting it would have shipped a no-op as a fix.
- **`degraded: false` when the feature is unconfigured.** If the fast path was never
  attempted (env var absent, feature off), that is not an outage — the paced path is
  correctly the only path, and fanning out there would hit the external API unpaced.
- **Test the distinction explicitly**, or the regression returns: assert `degraded === false`
  for a 200-with-no-matches and `degraded === true` for an exhausted retry budget. A test
  that only checks `map.size === 0` passes under both and proves nothing.
- Related: `abortsignal-timeout-covers-body-streaming.md` (another case where a failure is
  swallowed into a silently-partial result), and
  `async-fs-does-not-unblock-parse-bound-scan.md` (the half-fix that improves the obvious
  metric while the real symptom — cross-request latency — survives).
