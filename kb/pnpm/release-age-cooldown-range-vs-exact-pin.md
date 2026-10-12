---
tech: pnpm
tags: [pnpm, pnpm-12, minimum-release-age, cooldown, version-pinning, zod, resolution]
severity: high
---
# pnpm 12's release-age cooldown blocks a range but lets an exact pin through, so the same version resolves differently by spec

## PROBLEM
pnpm 12 applies a default `minimumReleaseAge` cooldown (about a day) without any config,
and `pnpm config get minimumReleaseAge` prints `undefined`, so it looks off. It acts
asymmetrically:
- A **range** (`zod@^4.6.0`) silently resolves to the newest release OLDER than the
  cooldown (4.6.5), with no warning.
- An **exact pin** to a same-day release (`zod@4.6.6`, published ~5 hours earlier) installs
  without complaint.

So "what is latest?" has two answers depending on how you ask. `pnpm view zod version` says
4.6.6, and a fresh `pnpm add zod@^4.6.0` gives 4.6.5. Consequences:
- Pinning `pnpm view`'s answer exactly pins a release the repo's own policy would have
  held back, and nothing flags it.
- A teammate who relaxes the pin to a range silently gets a different version, the drift
  that `typescript/zod-45-string-length-code-points` warns about.
- A transitive dep pinned exactly to the older release (here `@cloudflare/vitest-plugin`
  depends on `zod: 4.6.5`) disagrees with your pin, and an `overrides` entry quietly forces it.

Found 2026-10-11 on pnpm 12.11.2.

## WRONG
```bash
# "Pin latest exactly", where latest came from the registry, not from pnpm's resolver
v=$(pnpm view zod version)          # 4.6.6, published today
pnpm add "zod@$v"                   # installs, bypassing the cooldown
```

## RIGHT
```bash
# Ask the resolver what the cooldown allows: resolve a range in a scratch dir, then pin that.
mkdir -p /tmp/rel && cd /tmp/rel
printf '{"name":"t","private":true,"packageManager":"pnpm@12.11.2"}\n' > package.json
pnpm add 'zod@^4.6.0'               # -> 4.6.5: the newest release the cooldown allows
# Pin that exact version in the real repo (and in pnpm-workspace.yaml overrides).
```
Check publish times when in doubt: `pnpm view zod time --json | grep '"4.6.'`.

## NOTES
- Prefer pinning the newest version the cooldown allows over adding
  `minimumReleaseAgeExclude` entries. Exclusions accumulate and outlive their reason.
- The cooldown is a supply-chain control. Pinning around it defeats it without trace.
- Related: pnpm-11-blocks-build-scripts-until-allowbuilds mentions the cooldown in passing.
