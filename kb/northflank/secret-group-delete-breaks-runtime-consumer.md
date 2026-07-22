---
tech: northflank
tags: [secrets, secret-group, doppler, env, runtime-dependency, least-privilege, silent-failure]
severity: high
---
# Deleting a "CI-only" secret from a shared secret group can silently disable a runtime feature

## PROBLEM
A Northflank secret group (e.g. `doppler-env`, unrestricted, priority 10) is injected
into the env of EVERY service in the project. When you audit that group for
least-privilege and find a secret that looks like it belongs to a deploy/sync script,
it is tempting to conclude "no application code reads this at runtime" and drop it.

Two traps:

1. **A name-only grep is not proof.** The var may be read inside a service module that
   is imported by a mounted route. The grep hit looks like a config/docs mention until
   you follow the import chain to an entry point.
2. **The failure is silent.** Well-written integration code treats a missing token as
   "feature not configured" rather than throwing — exactly so it doesn't crash the
   route layer. So after the delete nothing errors, no alert fires, and the feature
   just quietly reports itself as unavailable. You find out when a customer does.

The audit instinct is right — an admin-scoped token really should not sit in the
ambient env of every web-facing process — but *deleting it from the group* is the
wrong lever. The group is the delivery mechanism for the legitimate consumer too.

Real case: `NORTHFLANK_API` in the SupportForge `doppler-env` group. The sync script
`scripts/sync-doppler-to-northflank.ts` reads it, which made it look CI-only. But
`src/services/northflank-domains.ts` also reads it via `nfToken()`, and that module is
imported by `src/routes/portal-vanity.ts`, which is mounted in `src/routes.ts`.
Removing it would have flipped `isNorthflankConfigured()` to false and disabled MSP
vanity-domain provisioning in production with no error anywhere.

## WRONG
```bash
# "Nothing reads this at runtime" -- based on a name-only grep that stopped
# at the first plausible-looking consumer.
grep -rn "NORTHFLANK_API" src/ | head
#   src/services/northflank-domains.ts:20:  *   NORTHFLANK_API   team API token ...
#   scripts/sync-doppler-to-northflank.ts:135:  const token = process.env.NORTHFLANK_API ...
# -> read as "a doc comment + the sync script", so: CI-only. Ship it.
```

```typescript
// scripts/sync-doppler-to-northflank.ts
const NEVER_SYNC = {
  NORTHFLANK_API: 'admin API token; sync script reads it from Doppler directly, no service needs it at runtime',
};
```

```bash
pnpm secrets:sync --allow-deletes
# Secret disappears from doppler-env. Next redeploy, the API container has no token.
# isNorthflankConfigured() -> false. Domain tab shows "provisioning not configured".
# Zero errors logged. Zero alerts. Feature is dead.
```

## RIGHT
```bash
# Trace the full chain from the env read to a mounted entry point before deleting.
# 1. Every read site, not just the first:
grep -rn "NORTHFLANK_API" --include="*.ts" src/ dashboard/ admin/ | grep -v node_modules

# 2. Who imports the module that reads it?
grep -rn "northflank-domains" --include="*.ts" src/
#   src/routes/portal-vanity.ts:25:} from '../services/northflank-domains';

# 3. Is that importer actually mounted / reachable at runtime?
grep -rn "portal-vanity" --include="*.ts" src/ | grep -v __tests__
#   src/routes.ts:42: import portalVanityRouter from './routes/portal-vanity';
#   src/routes.ts:106: router.use('/', portalVanityRouter);
# -> RUNTIME DEPENDENCY. Do not delete from the group.
```

Then fix the actual least-privilege problem — split the credential instead of
removing it:

```typescript
// Runtime reads ONLY the narrowly-scoped token.
// Dropping the admin-token fallback matters: if you leave `process.env.ADMIN_TOKEN ||`
// in the chain, the admin token still wins wherever it happens to be present, and
// you have changed nothing.
function nfToken(): string {
  return process.env.NORTHFLANK_API_TOKEN || '';   // domains + services scope only
}
```

- Mint a second, narrowly-scoped token for the service; keep it in the secret group.
- Move the admin token (the one that can rewrite the whole group) to a CI-only secret
  — GitHub Actions secret, not the shared group.
- Drop any admin-token fallback in BOTH the runtime read and the sync script, or the
  old credential silently keeps winning.
- If the platform supports restricted secret groups, also scope the group to the one
  service that needs it, so peer services stop seeing it at all.

## NOTES
- Sibling entry, opposite direction: `doppler-no-auto-sync-env-full-replace.md` covers
  secrets that never REACH the container. This one covers removing a secret that a
  container still needs. Both stem from the same root fact: the Northflank secret group
  is a mirror, not a live view of Doppler.
- A secret group edit only takes effect on **redeploy** — a plain restart reuses the
  old env snapshot. That widens the blast radius: the delete can look harmless for
  hours or days, then the feature breaks on an unrelated deploy, badly decoupling
  cause from symptom.
- Generalizes past Northflank to any injected-env platform (Kubernetes envFrom secretRef,
  ECS task-definition secrets, Fly/Render/Railway shared env): if one blob feeds every
  process, "which process needs this" is never answered by grepping for the name alone.
- Treat a task/ticket that ASSERTS "nothing reads X" as a hypothesis to verify, not a
  finding to act on — especially when the proposed action is destructive and the
  verification is a two-minute grep. Re-run the check yourself before the delete.
- Sanity check on exposure before escalating: in Next.js, a server-side env var is not
  reachable from the browser without a `NEXT_PUBLIC_` prefix. The risk from a shared
  admin token is blast radius on RCE / SSRF / env-in-logs, not direct client exposure —
  real, but it does not warrant an emergency destructive change.
