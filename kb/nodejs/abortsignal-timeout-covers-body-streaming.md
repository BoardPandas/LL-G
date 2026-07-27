---
tech: nodejs
tags: [fetch, abortsignal, timeout, streaming, undici, http, download]
severity: high
---
# AbortSignal.timeout() on fetch() covers body streaming, not just the response

## PROBLEM

`AbortSignal.timeout(ms)` reads like a *request* timeout -- "give up if the server does not answer in time." It is not. The signal aborts the whole `fetch` operation, and the response body is part of that operation. The clock keeps running while you consume `res.body`.

For ordinary JSON calls this never shows up: headers and body arrive together in milliseconds. It bites when the body is large or slow -- a bulk download, an SSE/streaming endpoint, a log tail. There the read legitimately takes minutes, so any header-sized timeout kills a transfer that was working fine.

The reason it is easy to get wrong: the abort does NOT surface at the `fetch()` call. That line resolves normally, and you get a `200` and a valid `res.body`. The `TimeoutError` is thrown later, out of the stream iteration, often several stack frames away inside a parser. A consumer that treats a stream error as end-of-input -- a `for await` wrapped in a `try/catch` that just logs, a streaming JSON parser that yields what it has -- turns the abort into a **silently partial dataset** rather than a failure. That is the high-severity case: the job reports success having ingested a fraction of the rows.

Measured on Node v24.18.0 against a local server that sends headers immediately then trickles the body, with `AbortSignal.timeout(400)`:

```
headers OK after 114ms (status 200)
RESULT: threw after 406ms -- DOMException: The operation was aborted due to timeout
```

Headers succeeded; the abort landed at the 400ms budget, mid-stream.

## WRONG

```js
// The timeout is meant to bound how long we wait for the server to respond.
// It actually bounds the entire download, so a multi-hundred-MB bulk file
// aborts partway through -- and the throw appears inside the parser, not here.
async function streamBulkDownload(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "MyApp/1.0" },
    signal: AbortSignal.timeout(60_000),   // <-- kills the body read at 60s
  });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  return res.body;
}

// Far away, the abort masquerades as a short file:
for await (const row of parseJsonArray(await streamBulkDownload(url))) {
  process(row);   // stops early; the run "succeeds" with partial data
}
```

## RIGHT

```js
// Bound the short request/response calls, and leave the streaming read unbounded.
// Split the two cases explicitly rather than sharing one fetch wrapper.

// (a) Small JSON call: a total-duration timeout is correct here.
async function fetchMetadata(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "MyApp/1.0" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`metadata failed: ${res.status}`);
  return res.json();
}

// (b) Large streaming download: no total-duration signal. A legitimate read
// takes far longer than any header timeout.
async function streamBulkDownload(url) {
  const res = await fetch(url, { headers: { "User-Agent": "MyApp/1.0" } });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  if (!res.body) throw new Error("download returned no body");
  return res.body;
}
```

If you do need to protect a long download against a stalled peer, use an **idle** timeout -- reset a timer on every chunk and abort only after inactivity -- not a total-duration one:

```js
const ac = new AbortController();
let idle = setTimeout(() => ac.abort(), 30_000);
const res = await fetch(url, { signal: ac.signal });
for await (const chunk of res.body) {
  clearTimeout(idle);
  idle = setTimeout(() => ac.abort(), 30_000);   // only stalls abort, not slow-but-moving transfers
  handle(chunk);
}
clearTimeout(idle);
```

## NOTES

- Same trap with a manually created `AbortController` on a timer, and with `signal: AbortSignal.any([...])` if any member is a timeout. It is the signal's lifetime that matters, not how it was constructed.
- The error is a `DOMException` with `name === "TimeoutError"` (a plain `AbortController.abort()` gives `name === "AbortError"`). Distinguish these if you retry: a timeout is worth retrying, a caller-initiated cancel is not.
- **Do not "fix" this by adding the timeout back.** Removing a timeout from a streaming fetch looks like an oversight to the next reader, so leave a comment at the call site saying why it is absent, or it will be re-added.
- Retry logic wrapping a streaming fetch can only retry establishing the response. Once the body has been handed to a consumer, a mid-stream failure has to be handled by restarting the whole read -- plan for that rather than assuming the retry helper covers it.
- Related: [fetch-user-agent.md](fetch-user-agent.md) -- the other non-obvious global-`fetch` trap, also found against a bulk data API.
