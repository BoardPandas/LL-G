---
tech: better-auth
tags: [better-auth, oauth-provider, mcp, rfc8707, resources, upgrade, config-drift, dynamic-client-registration]
severity: high
---
# oauth-provider 1.7 silently ignores validAudiences -- authorize dies with invalid_target

## PROBLEM

`@better-auth/oauth-provider` 1.7 replaced the 1.6 `validAudiences: string[]` option with persisted `oauthResource` rows, seeded from a new `resources` option. The old option was **deleted, not deprecated**, and nothing anywhere tells you:

- `tsc --noEmit` passes with `validAudiences` still in the config (verified on 1.7.1). The options object does not reject unknown keys, so a deleted option is indistinguishable from a supported one at compile time.
- The server boots **silently**. No warning, no "unknown option", nothing in the logs (verified: zero mentions across a full deploy's runtime log).
- Discovery, RFC 7591 registration, Google sign-in and `/healthz` all keep working. The service looks completely healthy.

Only `/oauth2/authorize` fails, and only when the client sends an RFC 8707 `resource`:

```
400 {"error":"invalid_target","error_description":"requested resource https://host/mcp/<name> is not configured"}
```

MCP clients **always** send `resource`, so in practice every connector authorization breaks while every other signal says the deployment is fine. Worse, the provider returns that error to the client rather than logging it, so grepping the server logs for `invalid_target` finds **nothing**. The only evidence is in the user's browser.

The trap is that this arrives bundled with the same bump's schema drift (see NOTES). You fix the 500s on registration, watch registration succeed, and reasonably conclude you are done -- then the next step of the same flow fails for an unrelated reason.

Second landmine, immediately after: once `resources` is declared, 1.7 defaults **`enforcePerClientResources` to `true`**, which requires a row in `oauthClientResource` linking each client to each resource. Clients that self-register via dynamic client registration are never linked, so every authorize then fails a second time with `client <id> is not linked to resource(s) <uri>`.

Inversion worth knowing when porting: under 1.6 the userinfo endpoint **had** to appear in `validAudiences` or `openid`-scoped requests were rejected. Under 1.7 it must **not** appear in `resources` -- `resolveResourcePolicy` resolves it as its own resource and skips it. The rule flipped.

## WRONG

```ts
// 1.6 config carried across a 1.6 -> 1.7 bump. Compiles, boots, serves --
// and rejects every connector authorization at runtime.
oauthProvider({
  allowDynamicClientRegistration: true,
  allowUnauthenticatedClientRegistration: true,
  // Deleted in 1.7. Not a type error, not a startup warning: silently ignored,
  // so the provider treats every connector resource as unknown.
  validAudiences: [
    ...providers.map((p) => `${baseURL}/mcp/${p}`),
    `${baseURL}/api/auth/oauth2/userinfo`, // 1.6 required this; 1.7 must NOT have it
    baseURL,
  ],
  scopes: ["openid", "profile", "email", "offline_access"],
})
```

## RIGHT

```ts
oauthProvider({
  allowDynamicClientRegistration: true,
  allowUnauthenticatedClientRegistration: true,

  // 1.7: seeds one oauthResource row per identifier on first use. An undeclared
  // `resource` is rejected as invalid_target. Do NOT list the userinfo endpoint --
  // the provider resolves and skips it (the opposite of 1.6's validAudiences).
  resources: [...providers.map((p) => `${baseURL}/mcp/${p}`), baseURL],

  // 1.7 defaults this to true. Clients that self-register (RFC 7591) are never
  // linked in oauthClientResource, so leaving it on rejects every one of them with
  // "client <id> is not linked to resource(s) <uri>". Turn it off when clients
  // register themselves; keep per-user access control in sign-in + consent, and
  // validate the token's `aud` per resource at the resource server.
  enforcePerClientResources: false,

  scopes: ["openid", "profile", "email", "offline_access"],
})
```

Confirm the option actually exists after any bump -- the typings are the only signal, since the runtime accepts anything:

```bash
grep -rn "validAudiences" node_modules/@better-auth/oauth-provider/dist/   # 1.7: no hits at all
grep -rn "resources?:\|enforcePerClientResources?:" node_modules/@better-auth/oauth-provider/dist/*.d.mts
```

## NOTES

- Same 1.6 -> 1.7 bump, other half: [better-auth 1.7 ships no CLI](cli-gone-generate-programmatically.md) covers the **schema** drift (missing columns -> empty-bodied HTTP 500 on registration and on JWKS key creation). This entry is the **config** drift. They present almost identically from the outside -- a connector that will not connect -- but neither fix helps the other.
- **A schema-drift CI check does not catch this.** A guard built with `getAuthTables()` compares declared tables against migration files; a removed *option* changes no table, so the check passes while authorize is broken in production. If you added that guard after the schema outage, do not assume it covers you here.
- Related resource-binding gotchas: [oauth-provider refresh breaks silent re-auth](oauth-provider-refresh-resource-binding.md), [resource server rejects every token](oauth-provider-resource-verification.md).
- Debugging shortcut: the failure is entirely client-side visible. Register a throwaway client, then call `/oauth2/authorize` with `resource=` set and read the `Location` header -- `302 -> /login` means the resource resolved, `400 invalid_target` or a `Location` carrying `error=invalid_target` means it did not. That distinguishes "resource not declared" from "client not linked" without reading any logs.
