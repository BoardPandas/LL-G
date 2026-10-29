---
tech: better-auth
tags: [microsoft, entra, oid, tid, multi-tenant, common-endpoint]
severity: high
---
# Better Auth 1.7 keys Microsoft accounts on oid alone, which is only unique within one Entra tenant

## PROBLEM
Better Auth 1.7's Microsoft provider stores the account id as the token's `oid`, but `oid` is only guaranteed unique inside one tenant, so a multi-tenant app on the `common` endpoint should key accounts on `tid` plus `oid`.
Sign-in works in testing with one tenant, so the weak key only shows up as an identity collision across tenants.

## WRONG
```ts
socialProviders: {
  microsoft: { clientId, clientSecret, tenantId: "common" }, // accountId = oid
}
```

## RIGHT
```ts
socialProviders: {
  microsoft: {
    clientId, clientSecret, tenantId: "common",
    async getUserInfo(tokens) {
      const claims = decodeIdToken(tokens.idToken); // validate first
      return {
        user: { id: `${claims.tid}:${claims.oid}`, email: claims.email,
                emailVerified: claims.email_verified === true || claims.xms_edov === true,
                name: claims.name },
        data: claims,
      };
    },
  },
}
```

## NOTES
Never key on `email`. Treat Microsoft email as verified only with `email_verified` or the optional `xms_edov` claim, which must be added in the app registration. Personal accounts all share one consumer tenant id, so never auto-join a company by `tid` for them.
