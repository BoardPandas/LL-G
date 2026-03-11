# Infrastructure Stack (Fixed)

This is the standard hosting architecture for all projects bootstrapped from this template. The plan-repo skill must use this infrastructure -- it is not negotiable or user-configurable.

## Architecture

```
User Browser
    |
    +---> Cloudflare Pages (frontend SPA/SSR)
    |         |
    |         +---> Northflank API (all backend logic + auth)
    |         |
    |         +---> Cloudflare R2 (public file downloads)
    |
    +---> Better Auth endpoints (hosted within Northflank API)
              |
              +---> /api/auth/sign-in
              +---> /api/auth/sign-up
              +---> /api/auth/sign-in/social (Google, Microsoft)
              +---> /api/auth/magic-link
              +---> /api/auth/passkey
              +---> /api/auth/two-factor

Northflank API Service
    |
    +---> Northflank Postgres (application data + auth tables)
    +---> Northflank Redis (caching, sessions, job queues)
    +---> Cloudflare R2 (signed URLs for private downloads)
    +---> Email provider (Resend/SES for magic links, OTPs)
    +---> External APIs (Stripe, webhooks, etc.)

Northflank Cron Jobs
    |
    +---> Scheduled tasks (cleanup, reports, sync, email digests)
    +---> Runs as standalone container on schedule
```

## Infrastructure Decisions (Locked)

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend hosting | Cloudflare Pages | SPA or SSR, deployed via Wrangler or git integration |
| Backend hosting | Northflank | Container-based, all API logic and auth |
| Database | Northflank Postgres | Application data + Better Auth tables |
| Cache/Queue | Northflank Redis | Sessions, caching, job queues |
| Object storage | Cloudflare R2 | Public downloads (direct) + private downloads (signed URLs) |
| Auth | Better Auth | Hosted within the Northflank API, not a separate service |
| Cron jobs | Northflank Cron | Standalone container on schedule |
| Email | Resend or AWS SES | Magic links, OTPs, transactional email |
| CDN | Cloudflare (automatic) | Comes with Pages |

## Auth Methods (Better Auth)

All projects include these auth methods by default:
- Email/password sign-in and sign-up
- Social sign-in (Google, Microsoft)
- Magic link
- Passkey (WebAuthn)
- Two-factor authentication (TOTP)

## What plan-repo Still Decides

The infrastructure above is fixed. Plan-repo researches and recommends only:
- Language and runtime (TypeScript/Bun, TypeScript/Node, Go, Rust, etc.)
- Frontend framework (Next.js, SvelteKit, Astro, Nuxt, etc.)
- Backend framework (Hono, Express, Fastify, Elysia, etc.)
- UI component library (shadcn/ui, Mantine, MUI, etc.)
- Styling approach (Tailwind, CSS Modules, etc.)
- ORM/query builder (Drizzle, Prisma, Kysely, etc.)
- Developer tooling (package manager, linter, formatter, test runner)
