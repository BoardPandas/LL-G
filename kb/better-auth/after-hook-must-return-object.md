---
tech: better-auth
tags: [hooks, after-hook, plugin, runAfterHooks, createAuthMiddleware, 500, dcr, mcp]
severity: high
---
# Plugin `after` hook handlers must return an object, not `undefined`

## PROBLEM
A Better Auth plugin `after` hook handler must resolve to an object (e.g. `{}`), not `undefined`/`void`. Better Auth's `runAfterHooks` (`better-auth/dist/api/to-auth-endpoints.mjs`) takes the handler's return value and immediately does `if (result.headers)` and `if (result.response)` on it with no null guard. A handler that runs `return;` (or has no return) resolves to `undefined`, so `result.headers` throws `TypeError: Cannot read properties of undefined (reading 'headers')`.

The throw happens AFTER the endpoint already succeeded, so the side effects ran (DB rows were written) but the successful 201/200 is converted into a 500. This makes it look like the endpoint itself failed when really only the post-hook bookkeeping did.

Real symptom: MCP Dynamic Client Registration created the `oauthApplication` (and our `mcp_clients`) row, then returned 500 because the governance after-hook returned nothing. Claude's connector showed "Couldn't register with Vigilis's sign-in service" even though registration had actually persisted.

## WRONG
```ts
// Plugin hook defined as a raw async function
hooks: {
  after: [
    {
      matcher: (ctx) => ctx.path === "/mcp/register",
      handler: async (ctx) => {
        await recordClient(ctx);
        // implicit `return undefined` -> runAfterHooks does result.headers -> TypeError -> 500
      },
    },
  ],
}
```

## RIGHT
```ts
// Option A: explicitly return an object in EVERY code path
handler: async (ctx) => {
  const client = await extractClient(ctx);
  if (!client) return {};        // early return must also be an object
  await recordClient(client);
  return {};                     // no response/header override
}

// Option B (idiomatic): wrap with createAuthMiddleware, which normalizes the return
import { createAuthMiddleware } from "better-auth/api";
handler: createAuthMiddleware(async (ctx) => {
  await recordClient(ctx);
})
```

## NOTES
- Returning `{}` means "don't override the response/headers"; return `{ response }` / `{ headers }` only when you actually want to replace them.
- Better Auth's own plugins (anonymous, bearer, custom-session, oidc/mcp) all wrap hook handlers in `createAuthMiddleware(...)`, which is why their void-bodied handlers work — the wrapper supplies the object shape.
- Applies to `before` hooks too: the before-hook runner reads `result.context`/`result.response` similarly.
- The side-effect-ran-but-500-returned shape is the tell: if rows are created but the client sees a 500, suspect a throwing after-hook rather than the endpoint.
