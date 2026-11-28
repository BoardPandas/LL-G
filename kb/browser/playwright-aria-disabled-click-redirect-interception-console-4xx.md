---
tech: browser
tags: [playwright, aria-disabled, click, actionability, route, interception, redirect, dns, console-error, chromium, 4xx]
severity: medium
---
# Playwright: click() waits on an aria-disabled button, interception never sees a redirect's next hop, and Chromium logs every 4xx as a console error

## PROBLEM
Three Playwright behaviours that make a correct test hang, leak, or fail:

1. **`click()` waits forever on an `aria-disabled` button.** Playwright's actionability check treats `aria-disabled="true"` as disabled and keeps waiting for the element to become enabled. A test that clicks such a button to prove "nothing happens" hangs until the test times out.
2. **Request interception never sees a redirect's next hop.** A `route()` handler is called for the first request only. If that request is answered with a redirect, the browser follows it without consulting the handler, so a test that believes it has blocked all outside traffic can still make a real request, or at least a DNS lookup, for the redirect target.
3. **Chromium logs every 4xx response as a console error.** "Failed to load resource: the server responded with a status of 401" is written by the browser, not by the page. A blanket "no console errors" assertion fails on every expected 401, 403, 404 or 429.

## WRONG
```ts
await page.getByRole("button", { name: "Allow" }).click();        // aria-disabled: waits until timeout

await page.route("**/*", (route) => route.abort());                 // a redirect's target is not routed

page.on("console", (m) => { if (m.type() === "error") throw new Error(m.text()); });   // trips on any 4xx
```

## RIGHT
```ts
// 1. Assert the state, or bypass the actionability check on purpose.
await expect(page.getByRole("button", { name: "Allow" })).toHaveAttribute("aria-disabled", "true");
await page.getByRole("button", { name: "Allow" }).click({ force: true });   // then assert nothing happened

// 2. Do not let a routed request answer with a redirect to somewhere real:
//    fulfil it yourself, or make the server under test redirect only to routed, local targets.

// 3. Allowlist the exact expected statuses and paths; everything else still fails.
const expected = [{ status: 401, path: "/api/session" }];
page.on("response", (r) => { /* record status + new URL(r.url()).pathname */ });
// after the test: every console error must correspond to an entry in `expected`
```

## NOTES
- For item 3, match on status **and** path. An allowlist of "any 401" hides a broken endpoint.
- For item 2, check for leaks from outside the browser (resolver or proxy logs), since the test itself cannot see the second hop.
