---
tech: better-auth
tags: [oauth-provider, jwt, revocation, mcp, access-token, oauthConsent, security]
severity: high
---
# Forcing JWT access tokens makes oauth-provider's revoke a silent no-op

## PROBLEM

`@better-auth/oauth-provider` writes an `oauthAccessToken` row **only for opaque tokens**. Its
own schema says so:

> *"An opaque access token sent when there is no resource audience claim to assigned to the JWT."*

Any MCP server following `oauth-provider-resource-verification.md` defaults `resource` in a
`/oauth2/token` before-hook so the provider mints a **JWT** instead — which is required, because
a resource server cannot verify an opaque token. The side effect is that `oauthAccessToken` is
then **never written at all**.

So the obvious "disconnect this application" implementation — mark that user's `oauthAccessToken`
rows revoked — matches **zero rows, always**. And a JWT is verified from its signature against
JWKS with no database read, so nothing in the request path can observe that the grant was
withdrawn. The client keeps full access until the token expires on its own.

It is silent in all three places you would look:

- **The revoke succeeds.** `updateMany` affecting no rows is not an error.
- **The UI confirms it.** The consent row is deleted, so the connection disappears from the list.
- **The connections screen actively lies.** A "live tokens" count built from the same table reads
  `0`, and a "last used" derived from it reads `never` — so a connection in constant use renders
  as *"Never used. No active session right now."* directly above its own revoke button. That
  false reassurance is usually what stops anyone from testing whether revoke works.

There is no error, no log line, and no failing test. The only way to catch it is to revoke a
connection and then deliberately keep using its token.

## WRONG

```ts
// Looks correct, does nothing: this deployment mints JWTs, so the table is empty.
revoke: async (userId, connectionId) => {
  const consent = await adapter.findOne({
    model: 'oauthConsent',
    where: [{ field: 'id', value: connectionId }, { field: 'userId', value: userId }],
  });
  if (!consent) return false;

  await adapter.updateMany({
    model: 'oauthAccessToken',                    // <-- opaque tokens only. Matches 0 rows.
    where: [{ field: 'userId', value: userId },
            { field: 'clientId', value: consent.clientId }],
    update: { revoked: new Date() },
  });
  await adapter.delete({ model: 'oauthConsent', where: [{ field: 'id', value: connectionId }] });
  return true;                                    // Credential still works until `exp`.
}

// ...and the resource server never consults any of it:
const { payload } = await jwtVerify(token, jwks, { issuer, audience });
return { userId: payload.sub, sessionId: payload.sid };   // signature is the whole check
```

## RIGHT

The **consent row is the grant**. Deleting it is what revoke actually accomplishes, so read it
on every request in the token-to-identity path:

```ts
// In the resource server, after verifying the JWT and before trusting it.
// Allow-list: a grant we can positively find -- never "no evidence it was revoked".
if (clientId === null) return { status: 'anonymous' };   // fail closed, see NOTES

const consent = await adapter.findOne({
  model: 'oauthConsent',
  where: [
    { field: 'userId', value: userId },       // BOTH predicates. See NOTES.
    { field: 'clientId', value: clientId },
  ],
});
if (!consent) return { status: 'anonymous' };  // grant withdrawn -> refuse
```

Sweep the **refresh token before** the access token in `revoke`, so a client cannot race the
delete by refreshing. A refresh token that survives can still mint a fresh JWT — and that JWT
dies at the consent check too, because the grant it descends from is gone.

Test it by asserting the refusal, and verify the test fails without the check — a revoked grant
must resolve to `anonymous`, not `ok`.

## NOTES

- **Scope the lookup by `userId` AND `clientId`.** By `clientId` alone the test above still
  passes (a revoked grant is gone for everyone) while any user's consent for a client silently
  authorises **every other user's** token from it — and one person reconnecting un-revokes
  everybody.
- **Fail closed when the token names no client.** `client_id`/`azp` absent means there is no
  grant to look up, and "cannot check" must not read as "nothing to check".
- **`skipConsent` clients write no consent row at all** (`if (client.skipConsent) return
  redirectWithAuthorizationCode(...)` — no consent is persisted). Under this design such a client
  is refused, which is the correct direction: it fails visibly at connect time instead of quietly
  exempting itself from revocation for the life of every token it holds. Do not "fix" that by
  allowing a missing consent row through.
- **Delete the fake usage columns.** A live-token count and last-used time derived from
  `oauthAccessToken` can only ever report zero and never. On a screen whose entire purpose is
  deciding what to cut off, a confident false negative is worse than an absent field. Real usage
  reporting needs a column of your own and a write on the request hot path.
- Removing that per-user token scan also drops a full table scan from every page load.
- This is the direct consequence of [oauth-provider resource server rejects every token](oauth-provider-resource-verification.md)
  and [oauth-provider refresh breaks silent re-auth](oauth-provider-refresh-resource-binding.md):
  both correctly tell you to force a JWT, and forcing a JWT is what empties the table revoke
  depends on. Apply either and you inherit this.
- Shortening the access-token lifetime bounds the damage but does not fix it. The window is
  whatever `exp` says — an hour by default.
