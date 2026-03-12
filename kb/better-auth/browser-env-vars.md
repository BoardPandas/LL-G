---
tech: better-auth
tags: [environment-variables, vite, process-env, import-meta-env, browser, cloudflare-pages]
severity: high
---
# Browser auth client uses import.meta.env not process.env

## PROBLEM
`process.env` is a Node.js runtime concept. It doesn't exist in browser environments or Cloudflare Pages. Using `process.env.VITE_API_URL` in a Vite frontend app silently evaluates to `undefined`, causing the auth client to use a wrong or empty base URL.

## WRONG
```typescript
const authClient = createAuthClient({
  baseURL: process.env.BETTER_AUTH_URL,  // undefined in browser
})
```

## RIGHT
```typescript
const authClient = createAuthClient({
  baseURL: typeof import.meta.env?.VITE_API_URL === "string"
    ? import.meta.env.VITE_API_URL.replace(/\/api\/trpc$/, "")
    : "https://api.example.com",
})
```

## NOTES
- Vite replaces `import.meta.env.VITE_*` at build time. Only variables prefixed with `VITE_` are exposed to the browser.
- The `.replace(/\/api\/trpc$/, "")` strips a tRPC path suffix if the env var is set to the full API URL.
- On the server side (Fastify, Next.js API routes, etc.), `process.env` is correct.
- Cloudflare Pages uses different env var injection -- check Cloudflare's documentation for the correct pattern if not using Vite.
