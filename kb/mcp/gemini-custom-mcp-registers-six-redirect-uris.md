---
tech: mcp
tags: [gemini, oauth, dcr, rfc7591, redirect-uri, allowlist, googleusercontent, diagnostics]
severity: high
---
# Gemini custom MCP registers six redirect URIs, not the one "Copy redirect URI" shows

## PROBLEM
Gemini web (Connectors → Custom → "Connect to an MCP server") registers through RFC 7591
dynamic client registration with **six** `redirect_uris` in one request, while its
"Copy redirect URI" button shows only one of them:

- `https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-<id>` (the one shown)
- the same path under `/a/` instead of `/r/`
- both paths on `oauth-redirect-sandbox.googleusercontent.com` and `oauth-redirect-test.googleusercontent.com`

An authorization server that allowlists redirect URIs and refuses a registration when any one
URI is off-list returns 400. Gemini shows the same text for **every** registration 400:
"The Google redirect URL was rejected by the server. Enter your OAuth client ID and client
secret to connect." So allowlisting only the copied URI still fails with an identical message,
and nothing in the UI tells you which URI or field was refused. An access log that records only
the status code cannot tell you either. In the original case this cost three production deploys.

The rest of the body: `client_name: "Google"`, `grant_types: [authorization_code, refresh_token]`,
`response_types: [code]`, `token_endpoint_auth_method: client_secret_post`. The registration
request's user agent is `OpenAuth`; the discovery requests before it use `Google`.

Do not allowlist the bare redirector hosts to make it work: `/r/<project-id>` on them hands the
authorization code to whichever Google Cloud project owns `<project-id>`, and anyone can create one.

## WRONG
```ts
// Host-only allowlist: either misses five of Gemini's URIs, or (if the hosts are added)
// lets any Google Cloud project receive authorization codes via /r/<its-project-id>.
const ALLOWED_HOSTS = ["claude.ai", "oauth-redirect.googleusercontent.com"];
const ok = (uri: string) => ALLOWED_HOSTS.includes(new URL(uri).hostname);

// Refusal is returned to the client and never logged.
if (!redirectUris.every(ok)) throw new APIError("BAD_REQUEST", { error: "invalid_redirect_uri" });
```

## RIGHT
```ts
// Pin the redirector hosts to Gemini's own namespace. GCP project IDs cannot contain "_",
// so no project can claim user_bound_custom-mcp-*.
const GEMINI_PATH = /^\/[ar]\/user_bound_custom-mcp-[A-Za-z0-9-]+$/;
const PINNED = new Map([
  ["oauth-redirect.googleusercontent.com", GEMINI_PATH],
  ["oauth-redirect-sandbox.googleusercontent.com", GEMINI_PATH],
  ["oauth-redirect-test.googleusercontent.com", GEMINI_PATH],
]);

function allowed(uri: string): boolean {
  const url = new URL(uri); // WHATWG parsing resolves "/../" before the path test
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const pinned = PINNED.get(url.hostname.toLowerCase());
  if (pinned) return !url.port && !url.search && !url.hash && pinned.test(url.pathname);
  return ALLOWED_HOSTS.includes(url.hostname.toLowerCase());
}

// Log every refused registration with the reason and the non-secret metadata.
if (status >= 400) {
  log.warn("oauth client registration refused", {
    status, error, error_description,
    userAgent: req.header("user-agent"),
    request: {
      fields: Object.keys(body),               // names only for jwks, software_statement, unknowns
      redirect_uris: body.redirect_uris,
      grant_types: body.grant_types,
      scope: body.scope,
      token_endpoint_auth_method: body.token_endpoint_auth_method,
    },
  });
}
```

## NOTES
- Captured 2026-11-24 from a live Gemini registration. The set of hosts may change. Get it from
  the refusal log line, not from the copy button.
- Keep the pin even when an operator adds the host to an env-driven extra-hosts list: check
  pinned hosts first so a config change cannot widen the path.
- Once registration succeeded, Gemini signed in without further changes on a Better Auth
  `@better-auth/oauth-provider` 1.7 server (confidential client, `client_secret_post`).
- Related: `kb/better-auth/oauth-provider-strict-client-discovery.md` and
  `kb/better-auth/oauth-provider-dcr-201-status.md`. Strict clients like Gemini also need the
  issuer and the 201 fixes from those entries.
