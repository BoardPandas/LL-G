---
tech: better-auth
tags: [oauth-provider, hooks, consent, authorize, dispatchAuthEndpoint, prompt, defu, redirect-loop]
severity: high
---
# oauth-provider re-runs /oauth2/authorize before-hooks after consent, so a forced prompt=consent loops Allow forever

## PROBLEM
After an approved consent POST, `@better-auth/oauth-provider` (1.7) issues the code by re-dispatching authorize internally: `consentEndpoint` calls `runOAuth2Authorize = dispatchAuthEndpoint(oauth2AuthorizeEndpoint, {...ctx})`. `dispatchAuthEndpoint` sets `path` to `/oauth2/authorize` and runs EVERY plugin before-hook again, with `ctx.request` still the original consent POST. The same happens from `/oauth2/continue` and the post-login hook.

A before-hook on `/oauth2/authorize` that forces `prompt=consent` (to make consent always show for a sensitive client) therefore re-adds it on that inner run. The provider has just stripped `consent` from the prompt, sees it again, and redirects back to the consent page. Clicking Allow loops forever. Nothing errors: the consent endpoint returns 200 with a redirect URL to the consent page, so no log or error tracker records anything.

Second trap in the same spot: a hook's returned `context.query` is merged with `defu` (`defuReplaceArrays(rest, internalContext)`). Deleting a key (`max_age`, `prompt`) from the returned query does NOT remove it, because the original value is refilled. Only overriding a key with a non-nullish value takes effect.

## WRONG
```ts
{
  matcher: (ctx) => ctx.path === "/oauth2/authorize",
  handler: createAuthMiddleware(async (ctx) => {
    if (ctx.query?.client_id !== CLI_CLIENT_ID) return;
    // Also runs on the re-dispatch from /oauth2/consent -> infinite loop
    return { context: { query: { ...ctx.query, prompt: "consent" } } };
  }),
}
```

## RIGHT
```ts
function isConsentRedispatch(request: Request | undefined): boolean {
  if (!request) return false;
  try {
    return new URL(request.url).pathname.endsWith("/oauth2/consent");
  } catch {
    return false;
  }
}

{
  matcher: (ctx) => ctx.path === "/oauth2/authorize",
  handler: createAuthMiddleware(async (ctx) => {
    if (ctx.query?.client_id !== CLI_CLIENT_ID) return;
    // The consent before-hook has already gated this request; don't re-prompt.
    if (isConsentRedispatch(ctx.request)) return;
    return { context: { query: { ...ctx.query, prompt: "consent" } } };
  }),
}
```

## NOTES
- Detect by request URL path, not method: `/oauth2/authorize` accepts POST too.
- Keep forcing the prompt on `/oauth2/continue` re-dispatches; there the user has not consented yet.
- This is safe only if a `/oauth2/consent` before-hook enforces your gate when `accept === true`. The re-dispatch only happens after that hook passes.
- Unit-test the hook with a `request: new Request(".../api/auth/oauth2/consent", { method: "POST" })` on the ctx. A test that passes only `path` and `query` can't see this.
- Found in vigilis v2.380.2 (`modero login` browser loop).
