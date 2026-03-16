---
tech: better-auth
tags: [fastify, cors, toNodeHandler, reply.raw, preflight, OPTIONS]
severity: high
---
# toNodeHandler + reply.raw bypasses Fastify CORS plugin

## PROBLEM
When mounting Better Auth in Fastify using `toNodeHandler(auth)` with `reply.raw`, the response completely bypasses Fastify's plugin chain. This means `@fastify/cors` never runs for auth routes. CORS preflight `OPTIONS` requests get no `Access-Control-Allow-Origin` header, and browser requests silently fail with `net::ERR_FAILED`. The server logs show no errors.

## WRONG
```typescript
import cors from "@fastify/cors"
import { toNodeHandler } from "better-auth/node"

// CORS plugin registered -- works for tRPC routes
await fastify.register(cors, { origin: /\.example\.com$/, credentials: true })

// Auth handler bypasses CORS entirely because reply.raw skips Fastify hooks
fastify.all("/api/auth/*", async (request, reply) => {
  await toNodeHandler(auth)(request.raw, reply.raw)
})
// Browser: "CORS policy: No 'Access-Control-Allow-Origin' header"
```

## RIGHT
```typescript
const ALLOWED_ORIGINS = [/\.example\.com$/, /^https?:\/\/localhost(:\d+)?$/]

function getAllowedOrigin(origin: string | undefined): string | false {
  if (!origin) return false
  for (const re of ALLOWED_ORIGINS) {
    if (re.test(origin)) return origin
  }
  return false
}

fastify.all("/api/auth/*", async (request, reply) => {
  const origin = request.headers.origin
  const allowed = getAllowedOrigin(origin)

  if (allowed) {
    reply.raw.setHeader("Access-Control-Allow-Origin", allowed)
    reply.raw.setHeader("Access-Control-Allow-Credentials", "true")
    reply.raw.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
    reply.raw.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
  }

  if (request.method === "OPTIONS") {
    reply.raw.statusCode = 204
    reply.raw.end()
    return
  }

  await toNodeHandler(auth)(request.raw, reply.raw)
})
```

## NOTES
- This affects any Fastify route that uses `reply.raw` or `request.raw` to hand off to a Node.js handler.
- The issue is invisible in development if the frontend and API share the same origin (localhost).
- You'll only see it in production when the frontend and API are on different subdomains.
- Also check Better Auth's `trustedOrigins` config -- it's a separate check from CORS headers.
