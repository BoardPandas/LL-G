---
tech: better-auth
tags: [oauth-provider, mcp, scopes, consent, connectors, authorization]
severity: high
---
# MCP connectors never request custom OAuth scopes -- tiered scope designs are silently bypassed

## PROBLEM
You define custom scope tiers (e.g. `read` / `write` / `admin`) on an @better-auth/oauth-provider MCP server and gate tools by scope. But AI connectors (Claude Code, Claude.ai, ChatGPT, Gemini) only ever request the OIDC base scopes `openid profile email offline_access` -- they don't know your tiers exist and there is no in-flow scope picker. Every minted token carries none of your tiers, which forces a fork: either tokens satisfy no tools (the connector is useless) or the server widens tier-less tokens by default (every token gets write, so a "read-only" authorization doesn't actually exist). Either way the tier design is bypassed for the common case, silently -- the consent screen says one thing, the token does another.

## WRONG
```ts
// Assuming clients will request tiers:
if (!scopes.has("write")) return scopeError();
// every connector token fails -- no client ever requests "write"

// Or widening silently with no surfaced choice:
function effectiveScopes(granted: Set<string>): Set<string> {
  if (hasAnyTier(granted)) return granted;
  return new Set([...granted, "read", "write"]); // read-only tier is now fiction
}
```

## RIGHT
```ts
// Decide deliberately and surface the decision:
//
// Option A (preferred): tier picker on the custom consent screen, persisted on
// the grant; effectiveScopes() honors the stored grant tier instead of widening.
// Existing tokens keep working; new authorizations get a real read-only choice.
//
// Option B: keep the widening as the documented default, with a loud comment at
// the widening site and in ops docs -- and honor explicit tiers verbatim if a
// client ever does send them. Accept that read-only does not exist in practice.
```

## NOTES
Per-resource ownership ACL still bounds blast radius to the user's own resources; the widening grants privilege-within-account, not cross-account -- but a user authorizing a "card lookup" connector is still silently handing it mutation rights. Related: [oauth-provider-mcp.md](oauth-provider-mcp.md), [oauth-provider-refresh-resource-binding.md](oauth-provider-refresh-resource-binding.md).
