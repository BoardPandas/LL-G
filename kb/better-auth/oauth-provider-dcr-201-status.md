---
tech: better-auth
tags: [oauth-provider, mcp, rfc7591, dynamic-client-registration, nextjs, status-code, antigravity, gemini]
severity: high
---
# oauth-provider dynamic client registration returns 200 instead of 201 through Next.js

## PROBLEM
A Better Auth `@better-auth/oauth-provider` MCP server completes authorization-server discovery, then strict clients (Antigravity/Gemini) reject registration with `dynamic client registration failed: registration failed with status 200` -- even though the response body is a valid client (has `client_id`). RFC 7591 mandates HTTP `201 Created` on a successful registration, and strict clients enforce it.

The plugin's register handler DOES set 201 (`ctx.json(body, { status: 201 })`), but when the auth handler is served through a Next.js route (`toNextJsHandler` / `app/api/auth/[...all]/route.ts`), the status is downgraded to `200` by the time it reaches the wire. So the body is correct but the status is wrong, and lenient clients (Claude) accept the 200 while strict ones fail.

## WRONG
```ts
// app/api/auth/[...all]/route.ts -- register 201 gets downgraded to 200 on the wire
import { toNextJsHandler } from "better-auth/next-js";
export const { GET, POST } = toNextJsHandler(auth);
// POST /api/auth/oauth2/register -> HTTP 200 {"client_id":"...", ...}
// strict client: "registration failed with status 200"
```

## RIGHT
```ts
// Intercept the register endpoint before the Next.js catch-all, run it through
// auth.handler directly, and normalize a successful (2xx with client_id) response to 201.
app.post("/api/auth/oauth2/register", express.json({ limit: "1mb" }), async (req, res) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const authz = req.header("authorization");
  if (authz) headers.authorization = authz;
  const upstream = await auth.handler(
    new Request(`${origin}/api/auth/oauth2/register`, { method: "POST", headers, body: JSON.stringify(req.body ?? {}) }),
  );
  const body = await upstream.text();
  const status = upstream.status === 200 && body.includes('"client_id"') ? 201 : upstream.status;
  res.status(status).setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
});
// (No raw Express server? In a pure Next app, wrap the register route handler / use middleware to rewrite the status.)
```

## NOTES
Verify with `curl -s -o /dev/null -w "%{http_code}" -X POST <origin>/api/auth/oauth2/register -H 'content-type: application/json' -d '{"client_name":"x","redirect_uris":["https://example/cb"],"grant_types":["authorization_code"],"response_types":["code"],"token_endpoint_auth_method":"none"}'` -- it must print `201`. The MCP SDK's `mcpAuthRouter` returns 201 here (working reference). Surfaces only AFTER the AS-issuer discovery gotcha is fixed -- the two failures appear in sequence. Related: [oauth-provider-strict-client-discovery.md], [oauth-provider-mcp.md].
