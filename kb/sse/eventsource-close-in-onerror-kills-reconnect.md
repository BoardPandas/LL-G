---
tech: sse
tags: [sse, eventsource, reconnect, backoff, jitter, realtime, deploy, streaming]
severity: high
---
# `source.close()` inside `onerror` permanently disables EventSource's own reconnect

## PROBLEM

`EventSource` reconnects automatically. That is the main thing it gives you over
a raw fetch stream. Calling `close()` in `onerror` — the reflex, because the
handler is named "error" and closing feels like tidying up — throws that away
permanently. There is no retry, ever, for the life of the page.

Two behaviours have to be separated, and the readyState is the only way to tell
them apart:

- **`CONNECTING`** — a transient drop. The browser is *already* retrying. Do
  nothing. Closing here is what converts a recoverable blip into a dead stream.
- **`CLOSED`** — terminal. Per spec, a non-2xx response or a bad content-type
  fails the connection and the client does **not** reconnect. Only a manual
  re-open recovers.

The second case is not exotic: **it is what every deploy looks like.** A rolling
restart answers 503 for a few seconds, which is precisely the terminal case, so
even correct `CONNECTING` handling still needs a manual re-open path or
real-time dies on every release.

What makes this expensive is that nothing announces it. No exception, no console
error, no failed request in the network panel — the page simply stops updating.
Every screen keeps showing whatever it fetched on load, so it reads as "the live
feature was never wired up" rather than "the transport died", and the only
recovery is a user happening to reload. A card labelled "Live activity" sitting
there static is the whole symptom.

## WRONG

```js
const source = new EventSource("/api/events", { withCredentials: true });

source.addEventListener("update", (e) => applyEvent(JSON.parse(e.data)));

source.onerror = () => {
  // Kills the browser's automatic retry. After the next deploy this page
  // receives nothing until it is reloaded, and says nothing about it.
  source.close();
};
```

## RIGHT

```js
function connect(onEvent, onReconnect) {
  let source = null, timer = null, attempt = 0, opened = false, stopped = false;

  const open = () => {
    if (stopped) return;
    source = new EventSource("/api/events", { withCredentials: true });

    source.onopen = () => {
      attempt = 0;
      // Events emitted while disconnected are gone -- SSE has no replay.
      // Refetch, or the UI stays stale until some later event arrives.
      if (opened) onReconnect();
      opened = true;
    };

    source.addEventListener("update", (e) => onEvent(JSON.parse(e.data)));

    source.onerror = () => {
      if (source?.readyState !== EventSource.CLOSED) return; // browser retries
      source.close();
      source = null;
      schedule();
    };
  };

  const schedule = () => {
    if (stopped || timer) return;
    // Full jitter: a deploy drops every client in the same instant, so a fixed
    // backoff marches them all back in lockstep.
    const ceiling = Math.min(30_000, 1000 * 2 ** attempt++);
    timer = setTimeout(() => { timer = null; open(); }, Math.random() * ceiling);
  };

  open();
  return () => { stopped = true; clearTimeout(timer); source?.close(); };
}
```

## NOTES

- **Reconnecting is only half of it.** SSE has no replay: whatever happened
  during the gap is lost. If you reconnect without refetching, the UI is stale on
  exactly the data that changed while it was disconnected, and stays stale until
  an unrelated event happens to arrive. Invalidate on re-open — but skip the
  *first* open, where nothing was missed.
- **Jitter is load-bearing, not polish.** The disconnect is correlated by
  construction (one restart, every client), so unjittered backoff produces a
  synchronised retry storm against a server that is still coming up.
- **Testing it:** jsdom has no `EventSource`, so stub one that lets you drive
  `readyState` and fire `onerror`/`onopen`. Then verify the tests fail against the
  old one-line handler — a reconnect test that passes both before and after is
  asserting nothing.
- **Verifying it in production** costs one restart: load the page, restart the
  API, and *do not reload* — then mutate something and check the UI updates on
  its own. Note that browser devtools may deduplicate by URL in the network
  panel, so you may not be able to count the reconnect attempts; assert on
  behaviour (does an event still land?) rather than on request counts.
- The server side of the same feature has its own trap: a stream written through
  a framework's raw response object often bypasses the CORS plugin, so the
  browser discards a perfectly healthy 200. See `kb/fastify/reply-raw-bypasses-plugin-chain.md`.
  And compression middleware buffers SSE, which looks like late/bursty events
  rather than absent ones — see `kb/express/`.
