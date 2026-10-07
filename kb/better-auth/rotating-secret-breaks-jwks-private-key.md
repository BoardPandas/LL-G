---
tech: better-auth
tags: [jwt-plugin, jwks, secret-rotation, oauth-provider, mcp, encryption]
severity: high
---
# Rotating BETTER_AUTH_SECRET makes the jwt() plugin's JWKS private key undecryptable

## PROBLEM
The `jwt()` plugin encrypts its signing private key with the auth secret before storing it in
the `jwks` table (`createJwk` -> `symmetricEncrypt({ key: ctx.context.secretConfig })`,
`plugins/jwt/utils.mjs`). With a single `secret` the ciphertext is bare hex with no version tag.
After a rotation, every signature decrypts the newest live key and throws
(`plugins/jwt/sign.mjs`, verified on 1.7.6):

```
Failed to decrypt private key. Make sure the secret currently in use is the same as the one used to encrypt the private key. If you are using a different secret, either clean up your JWKS or disable private key encryption.
```

Every OAuth code exchange and refresh signs a JWT, so every MCP/OAuth client loses token
issuance at once. Runbooks commonly say "rotating the secret only signs everyone out"; that is
wrong whenever jwt() (or oauth-provider, which requires it) is enabled. The error's own
suggestions are also traps: deleting the rows unpublishes the old public key (issued access
tokens fail verification), and `disablePrivateKeyEncryption` stores the key in plaintext.

## WRONG
```bash
# set a new secret, redeploy, done
doppler secrets set BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
# ...or follow the error message and "clean up your JWKS":
psql -c 'DELETE FROM jwks;'
```

## RIGHT
```sql
-- 1. Roll out the new secret and confirm the running process has it.
-- 2. THEN expire (never delete) every live key:
UPDATE jwks SET "expiresAt" = now()
 WHERE "expiresAt" IS NULL OR "expiresAt" > now();
-- Signing only uses keys with null/future expiresAt and mints a new one under the
-- CURRENT secret when none is live. /jwks keeps publishing an expired key for
-- jwks.gracePeriod (default 30 days), so already-issued tokens keep verifying.
```

## NOTES
- Order matters: expiring while a process still runs the OLD secret mints the replacement under
  the old secret, repeating the outage. Expire only after the new secret is live; the short gap
  before the UPDATE just fails token requests (a live key exists, so nothing is minted).
- A resource with a pinned `signingKeyId` is refused, not replaced, once that key expires; check
  `oauthResource` first.
- Unaffected: refresh tokens, stored access tokens and client secrets (unkeyed SHA-256 by default).
  Also broken by a rotation: session cookies, in-flight signed `oauth_query`, refresh-rotation replay.
- 1.7.x also supports versioned `BETTER_AUTH_SECRETS` ("<version>:<secret>,..."); bare-hex rows then
  decrypt only via `legacySecret` (= `BETTER_AUTH_SECRET`).
