---
tech: react-native
tags: [expo, abortsignal, cancellation, streaming, fetch, native-testing]
severity: high
---
# Native AbortSignal methods and listener lifetimes differ from browser tests

## PROBLEM

A fetch wrapper passes TypeScript, Node tests, and browser tests, then fails on a phone at `signal.throwIfAborted()`. React Native 0.86.3 installs the `abort-controller` 3.0.0 implementation when the global is absent; its signal has `aborted` and abort events but no instance `throwIfAborted` or `reason`. Expo 57.0.27 patches static `AbortSignal.any` and `AbortSignal.timeout`, not the missing instance method. Static methods existing does not establish browser-equivalent instance support.

Cancellation composition has a second lifetime trap. The inspected Expo `any` polyfill removes source listeners when a source aborts, not when an unrelated fetch promise finishes. Repeated completed JSON requests can therefore retain listeners on a long-lived caller signal. Removing every relay at response headers fixes that leak but breaks later stream cancellation; aborting the controller in a universal `finally` instead kills a successfully returned stream.

## WRONG

```typescript
caller?.throwIfAborted(); // Native instance may not implement this.
const controller = new AbortController();
const signal = caller
  ? AbortSignal.any([controller.signal, caller])
  : controller.signal;
try {
  return await fetch(url, { signal }); // Headers are not body completion.
} finally {
  controller.abort(); // Stops a stream handed to the caller.
}
```

## RIGHT

Use the smallest verified signal surface, own the relay, and distinguish buffered-body completion from stream handoff. Return an explicit cleanup handle if the stream reader owns the rest of the lifetime.

```typescript
function cancelled() {
  const error = new Error("Request cancelled");
  error.name = "AbortError";
  return error;
}

function requestLifetime(caller: AbortSignal | undefined, timeoutMs: number) {
  if (caller?.aborted) throw cancelled();
  const controller = new AbortController();
  const detach = () => caller?.removeEventListener("abort", relay);
  const relay = () => { detach(); controller.abort(); };
  caller?.addEventListener("abort", relay, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    headersArrived: () => clearTimeout(timer),
    dispose: () => { clearTimeout(timer); detach(); },
    cancel: () => { clearTimeout(timer); detach(); controller.abort(); },
  };
}

async function readJson(url: string, caller?: AbortSignal) {
  const life = requestLifetime(caller, 15_000);
  try {
    const response = await fetch(url, { signal: life.signal });
    return await response.json(); // Keep deadline through body consumption.
  } finally {
    life.dispose();
  }
}

async function openStream(url: string, caller?: AbortSignal) {
  const life = requestLifetime(caller, 15_000);
  try {
    const response = await fetch(url, { signal: life.signal });
    life.headersArrived(); // Reader now owns idle timeout, not this deadline.
    return { response, dispose: life.dispose, cancel: life.cancel };
  } catch (error) {
    life.cancel();
    throw error;
  }
}
// The stream consumer calls dispose on EOF/error and cancel on abandonment.
// Do not call either merely because openStream returned its headers.
```

## NOTES

- Verified against installed React Native 0.86.3 `Libraries/Core/setUpXHR.js`, `abort-controller` 3.0.0, and Expo 57.0.27 `src/winter/AbortSignal.ts`. Reinspect the installed runtime after upgrades; this is not a claim about all future native implementations.
- Optional chaining on `caller` only handles a missing caller, not a missing method. Optional-calling the method would silently skip cancellation; explicitly inspect `aborted` instead.
- Some body implementations ignore abort. When a hard deadline is required, race consumption against an owned abort promise as well, remove its listener when settled, and handle both promise outcomes. Never retry an ambiguous mutation merely because its deadline elapsed.
- Add native-like signal tests without `throwIfAborted` or `reason`: pre-aborted caller makes no request; in-flight abort settles; body deadline remains active after headers; successful JSON/text removes source listeners; streaming survives headers and still cancels later; stream completion/cancellation releases ownership. Browser or Node globals alone cannot test this mismatch.
- Related: [AbortSignal.timeout also covers body streaming](../nodejs/abortsignal-timeout-covers-body-streaming.md). That entry concerns the intended timeout scope; this one concerns native API availability and explicit cancellation ownership.
- This is a runtime technology lesson, not an agent-configuration defect. No configuration eval is appropriate; enforce it with transport regression tests.
