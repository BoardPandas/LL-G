---
tech: better-auth
tags: [oauth-provider, oauth2, consent, mcp, oauth_query, pkce, authorization-code, oauth-resource]
severity: high
---
# @better-auth/oauth-provider: a custom consent page must echo the signed oauth_query in the POST body

## PROBLEM
When you supply a custom `consentPage` to `@better-auth/oauth-provider` (instead of using the plugin's built-in page), the authorize step redirects the browser to that page with the FULL SIGNED authorization query in the URL (`client_id`, `scope`, `redirect_uri`, `state`, plus `exp`, `ba_iat`, `sig`). It is tempting to assume the consent endpoint reads those params from the page URL or from a cookie. It does NOT.

`POST /api/auth/oauth2/consent` recovers the pending OAuth request from request state that is populated by a plugin `before` hook whose matcher is literally `ctx.body?.oauth_query`. If the consent page POSTs only `{ accept }`, that matcher returns falsy, the hook never runs, the request state stays empty, and `consentEndpoint` throws `APIError("BAD_REQUEST", { error: "invalid_request", error_description: "missing oauth query" })` -- an HTTP 400 that silently blocks the ENTIRE OAuth / MCP authorization handshake. The user signs in with Google, clicks "Allow access", and the grant just fails with a cryptic message.

The page must send back the same signed query string it received in its URL. The server re-verifies the signature (`verifyOAuthQueryParams` re-signs the query minus `sig` and constant-time compares, and checks `exp`), so the string must be passed verbatim. Send it for BOTH accept and deny -- the deny path still needs `redirect_uri` from the recovered query to build the `access_denied` redirect.

Tell: `error_description: "missing oauth query"`, `error: "invalid_request"`, HTTP 400, on `POST /oauth2/consent`. Verified against `@better-auth/oauth-provider` 1.6.14. The same `oauth_query` requirement applies to the related `/oauth2/continue` flows (select_account / create / post_login).

This class of bug slips through any verification that only curl-checks that `/consent` RENDERS, because the failure is in the authenticated consent SUBMISSION, not the page load. Test the actual POST, not just the GET.

## WRONG
```js
// consent.html -- the page received ?client_id=...&scope=...&exp=...&ba_iat=...&sig=...
// but sends only the decision. The /oauth2/consent before-hook (matcher:
// ctx.body?.oauth_query) never fires -> request state is empty ->
// 400 invalid_request "missing oauth query", whole OAuth flow blocked.
await fetch('/api/auth/oauth2/consent', {
  method: 'POST',
  credentials: 'include',
  headers: { 'content-type': 'application/json', 'accept': 'application/json' },
  body: JSON.stringify({ accept: true }),
});
```

## RIGHT
```js
// Echo the page's full signed query string back as oauth_query, verbatim.
// The server re-verifies the signature, so do not re-encode or reorder it.
// Send it for both accept and deny.
const oauthQuery = location.search.replace(/^\?/, '');

await fetch('/api/auth/oauth2/consent', {
  method: 'POST',
  credentials: 'include',
  headers: { 'content-type': 'application/json', 'accept': 'application/json' },
  body: JSON.stringify({ accept: true, oauth_query: oauthQuery }),
});
// On success the response JSON has { redirect_uri } (or a 302) -> navigate the
// browser there to deliver the authorization code back to the client.
```

## NOTES
- The consent endpoint body schema is `{ accept: boolean, scope?: string, oauth_query?: string }`. `oauth_query` is typed optional but is effectively required for any flow that needs to recover the pending request (i.e. the normal redirect-from-authorize flow).
- Pass the query verbatim (`location.search` minus the leading `?`). Do not rebuild it through a fresh `URLSearchParams().toString()` if you can avoid it -- the signature was computed over the server's serialization; re-encoding risks a signature mismatch (`invalid_signature`). The server re-parses and re-serializes on its side, so verbatim is the safe choice.
- This is the consent-page counterpart to the migration gotcha in [oauth-provider-mcp.md](oauth-provider-mcp.md) (mcp() deprecated -> oauth-provider). After you migrate and stand up a custom consent page, this is the next thing that bites.
- Related: the protected-resource metadata / issuer gotchas for the same plugin -- issuer is `<origin>/api/auth` (not the bare origin), and RFC 9728 PRM must advertise only the resource's own scopes (not the OIDC `openid` scope).
