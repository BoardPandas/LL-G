---
tech: mcp
tags: [oauth, authorize, consent, samesite, csrf, dynamic-client-registration, pkce, redirect-uri, rfc-8252]
severity: high
---
# An /authorize that issues a code on session-cookie presence is a consent bypass

## PROBLEM

An MCP authorization server's `authorize()` checks for a signed-in session and, finding
one, issues a code straight to the client's redirect. That reads as "the user is logged
in, so it is them asking" -- and it is not.

- The session cookie is `SameSite=Lax`, which is **sent on a top-level cross-site GET**.
  A link on any page, email or chat message that navigates to `/authorize` carries it.
- Dynamic client registration is open. The MCP TypeScript SDK's `OAuthClientMetadataSchema`
  refuses only `javascript:`/`data:`-style schemes; it accepts any `https://` redirect, and
  plain non-loopback `http://` too (checked against `@modelcontextprotocol/sdk` 1.31.0).
- PKCE does not help: the attacker registered the client and chose the `code_challenge`,
  so they hold the verifier.

So anyone can `POST /register` a client with redirect `https://evil.example/cb`, send a
signed-in user a crafted `/authorize?client_id=…&redirect_uri=https://evil.example/cb&
code_challenge=<theirs>&scope=<anything>` link, receive the code, and redeem it for a token
as that user. In SupportForge the scope reached remote command execution on endpoints.
Audience binding, scope narrowing on refresh and token revocation all work correctly
downstream and none of them matter, because the grant itself was never consented to.

Nothing fails. The legitimate client (Claude Code) works perfectly, every test of the token
endpoint passes, and the hole is only visible by asking what a *third party's* link does.

## WRONG

```ts
async authorize(client, params, res) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(res.req.headers) });
  if (!session?.user) return res.redirect(302, loginUrl);
  // Cookie present => issue. Any registered client, any redirect, any scope.
  const code = await issueAuthorizationCode(db, { userId: session.user.id, ...params });
  res.redirect(302, `${params.redirectUri}?code=${code}&state=${params.state}`);
}
```

## RIGHT

```ts
async authorize(client, params, res) {
  const request = { clientId: client.client_id, redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge, scopes: params.scopes ?? [],
    state: params.state ?? null, resource: params.resource?.href ?? null };
  const userId = await sessionStaffUserId(res.req);   // may be null
  // The cookie only lets an ALREADY-APPROVED (user, client_id, redirect, resource,
  // scopes ⊆ approved) request skip the page. It is never a reason to issue on its own.
  if (userId === null || !(await hasRememberedConsent(db, { userId, ...request }))) {
    // Short-lived signed JWT of exactly what the SDK validated; nothing in it is secret.
    return res.redirect(302, `${dashboard}/oauth/consent?request=${sign(request)}`);
  }
  const code = await issueAuthorizationCode(db, { userId, ...request });
  res.redirect(302, authorizationRedirect(request.redirectUri, { code, state, issuer }));
}

// The code is issued only by the consent page's POST, bound to the SESSION user (never a
// body field), for exactly what the signed request names. Hold that POST to the page:
// JSON content type + Origin === dashboard origin + Sec-Fetch-Site same-origin, because
// a sibling *.example.com origin is same-site and Lax WOULD send the cookie on its POST.
router.post('/decision', browserBoundary, async (req, res) => { /* approve | deny */ });
```

Show on the consent page: the client's self-reported name **marked unverified** (anyone can
register "Claude Code"), the redirect host (warn when it is a website rather than loopback,
and when it is not https), the resource, and each scope. Deny redirects with
`error=access_denied`. Send `X-Frame-Options: DENY` / `frame-ancestors 'none'` on the page
so Approve cannot be clickjacked.

## NOTES

- Remember consent per (user, client_id, redirect, resource) with requested scopes a
  subset of the approved set, or routine reconnects re-prompt every time. Strip the port
  from **loopback** redirects in that key: RFC 8252 native clients (Claude Code) take a new
  ephemeral port per sign-in, and the SDK already matches loopback redirects
  port-insensitively. Keep non-loopback redirects exact. Never key on `client_name`.
- Revoking a connection must also forget its remembered consent, or the client walks
  straight back in on its next `/authorize`.
- A CLI or API token that acts as the user is not the user looking at the page. Refuse
  it at the decision endpoint, as a first-party CLI's own consent route should.
- If several clients share one signed pending-request format, each consent endpoint must
  refuse the others' requests; otherwise a request meant for a stricter screen (e.g. one
  requiring a write acknowledgment) can be approved on a laxer one.
- The old signed-out branch redirected to `/login?redirect=` while the login page read
  `callbackUrl`, so every sign-in landed on the home page. Routing through a dashboard
  consent page lets the dashboard's own login round trip carry the request.
- Confirm with a unit test before fixing: authorize as a signed-in user for a client that
  was never approved and assert no code row is written and no redirect carries `code=`.
