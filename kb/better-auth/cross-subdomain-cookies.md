---
tech: better-auth
tags: [cookies, subdomains, cross-subdomain, session, domain-config]
severity: high
---
# Cross-subdomain cookies require explicit config

## PROBLEM
By default, Better Auth sets cookies for the exact domain. If your API and frontend are on different subdomains (e.g., `api.example.com` and `app.example.com`), session cookies won't travel between them and auth silently fails.

## WRONG
```typescript
// server.ts -- no cookie domain config
export const auth = betterAuth({
  database: db,
  // ... no advanced.crossSubDomainCookies
})
// Result: cookies set for api.example.com only, app.example.com can't read them
```

## RIGHT
```typescript
export const auth = betterAuth({
  database: db,
  advanced: {
    crossSubDomainCookies: {
      enabled: true,
      // Leading dot = all subdomains of example.com
      domain: process.env.NODE_ENV === "production" ? ".example.com" : undefined,
    },
  },
})
```

## NOTES
- The leading dot in `.example.com` is required -- it signals "this domain and all subdomains" per the cookie spec.
- Set `domain: undefined` in development to avoid cross-subdomain config in localhost environments.
- The `twoFactor` signIn response uses a `redirect` boolean, not `twoFactorRedirect`. Check `if (data?.redirect) navigate("/mfa")` not `if (data?.twoFactorRedirect)`.
