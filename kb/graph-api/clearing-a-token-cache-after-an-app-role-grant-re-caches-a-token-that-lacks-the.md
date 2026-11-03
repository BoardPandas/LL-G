---
tech: graph-api
tags: [token-cache, app-roles, permission-propagation, 403, client-credentials, entra]
severity: high
---
# Clearing a token cache after an app-role grant re-caches a token that lacks the role

## PROBLEM
Clearing an app-only token cache right after granting an app role does not help: the next token is minted before Entra propagates the role, and it is then cached for its full lifetime.
Entra takes 1-15 minutes to put a newly granted app role into tokens, and an issued token never gains roles. A cache that clears on write and then holds tokens until 5 minutes before expiry keeps a role-less token for ~55 minutes, so every call returns 403 "Request Authorization failed" although the grant is in place. It looks like a consent problem, and only another cache clear (for example a no-op PATCH that triggers one) fixes it.

## WRONG
```typescript
export function clearTokenCache() {
  tokenCache.clear();
}
// after mint:
tokenCache.set(key, { token, expiresAtMs: Date.now() + lifetimeMs - 5 * 60_000 });
```

## RIGHT
```typescript
const ROLE_PROPAGATION_WINDOW_MS = 15 * 60_000;
const POST_CLEAR_TOKEN_TTL_MS = 2 * 60_000;
let cacheClearedAtMs: number | undefined;

export function clearTokenCache() {
  tokenCache.clear();
  cacheClearedAtMs = Date.now();
}
// after mint (measured when the token lands, so in-flight requests are covered):
const now = Date.now();
const normal = now + Math.max(lifetimeMs - 5 * 60_000, 0);
const inWindow = cacheClearedAtMs !== undefined && now - cacheClearedAtMs < ROLE_PROPAGATION_WINDOW_MS;
tokenCache.set(key, { token, expiresAtMs: inWindow ? Math.min(normal, now + POST_CLEAR_TOKEN_TTL_MS) : normal });
```

## NOTES
Keep the scope (audience) in the cache key. See permission-propagation for the 1-15 minute delay. The short TTL costs one extra token request every 2 minutes for 15 minutes after a write, and nothing at other times.
