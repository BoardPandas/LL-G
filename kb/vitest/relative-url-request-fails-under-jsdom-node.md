---
tech: vitest
tags: [jsdom, node, request, fetch, relative-url, generated-api-client, openapi, testing]
severity: medium
---
# jsdom/Node `Request` rejects relative URLs, so a generated API client that builds `new Request("/api/...")` cannot run in Vitest without a resolver shim

## PROBLEM
In a browser, `new Request("/api/items")` resolves the path against the page's URL. Under Vitest with the jsdom (or node) environment, `Request` is Node's implementation, which has no base URL and throws on a relative URL. A generated API client that constructs `Request` objects from relative paths works in the browser and throws in every unit test, before any mock of `fetch` is reached.

## WRONG
```ts
// generated client
const request = new Request("/api/items", { method: "GET" });   // throws under Vitest: relative URL
return fetch(request);
```

## RIGHT
```ts
// vitest.setup.ts: resolve relative URLs against a fixed test origin.
const NativeRequest = globalThis.Request;
globalThis.Request = class extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
  }
} as typeof Request;
```

## NOTES
- The shim belongs in test setup only. Alternatively configure the generated client with an absolute base URL in tests, if it supports one.
- A mock for `fetch` then receives absolute URLs; match on the path (`new URL(request.url).pathname`), not the whole string.
