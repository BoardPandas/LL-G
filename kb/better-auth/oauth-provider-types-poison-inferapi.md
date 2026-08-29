---
tech: better-auth
tags: [better-auth, oauth-provider, typescript, inferapi, openapi, types, 1.7.1]
severity: medium
---
# oauth-provider@1.7.1's own types poison InferAPI for the whole auth instance

## PROBLEM

`@better-auth/oauth-provider@1.7.1` ships a declaration that does not satisfy `better-auth@1.7.1`'s
own `BetterAuthPlugin`. Its `/oauth2/authorize` endpoint declares OpenAPI `parameters` where one
union member omits `schema.items`, which `OpenAPIParameter` requires. Both packages are pinned to
1.7.1 and only one copy of `@better-auth/core` is installed — this is not a duplicate-version
artefact, the published declaration is simply wrong.

What makes it costly is the blast radius. A plugin that is not assignable to `BetterAuthPlugin`
**poisons `InferAPI` for the entire instance**, so `auth.api` collapses to a bare type and
everything you actually call disappears:

```
Property 'getActiveMember' does not exist on type 'InferAPI<...>'
Property 'createInvitation' does not exist on type 'InferAPI<...>'
Property 'cancelInvitation' does not exist on type 'InferAPI<...>'
```

Those errors land in files that have nothing to do with OAuth — session resolvers, invitation
services, organization adapters — so the reported failures point everywhere except the plugin that
caused them. It is easy to spend the debugging time on the wrong files.

Nothing about the runtime is affected: the offending declaration is documentation metadata.

## WRONG

```ts
export const auth = betterAuth({
  plugins: [
    jwt(),
    oauthProvider({ ... }),   // not assignable to BetterAuthPlugin
  ],
});

// Dozens of errors, none of them here:
const member = await auth.api.getActiveMember({ headers });   // "does not exist"
```

## RIGHT

```ts
import type { BetterAuthPlugin } from 'better-auth/types';

export const auth = betterAuth({
  plugins: [
    jwt(),
    // The cast contains a library type bug to one line. Nothing about the runtime
    // changes -- the bad declaration is OpenAPI documentation metadata.
    //
    // Cost, stated: the oauth endpoints are absent from auth.api's inferred type.
    // Acceptable when nothing calls them that way -- clients reach them over HTTP,
    // and anything you touch by hand goes through the request handler or a
    // `before` hook, neither of which reads the inferred type.
    //
    // Re-check on every better-auth bump; delete when it type-checks without it.
    oauthProvider({ ... }) as unknown as BetterAuthPlugin,
  ],
});
```

## NOTES

- Diagnose it from the **plugin**, not from the reported files. If adding a plugin makes unrelated
  `auth.api.*` members vanish, the plugin failed the `BetterAuthPlugin` constraint — read the first
  error in the list, not the loudest cluster.
- Confirm it is not a version skew before casting: `pnpm ls @better-auth/core` should show exactly
  one entry, and the plugin's `peerDependencies` should match your `better-auth` version.
- Do not widen the cast beyond the one plugin. `as any` on the whole `plugins` array hides the next
  real mismatch.
- Related: `oauth-provider-mcp.md`, `oauth-provider-requires-session-in-database.md`.
