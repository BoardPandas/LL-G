---
tech: nextjs
tags: [pino, logging, config, next-config, server-components]
severity: high
---
# serverExternalPackages (not experimental) for Pino in Next.js 15+

## PROBLEM
The config key for externalizing server-side packages was renamed from `experimental.serverComponentsExternalPackages` to `serverExternalPackages` in Next.js 15. Using the old name silently fails — Pino's worker-thread transport breaks without warning.

## WRONG
```ts
// next.config.ts — old name, silently ignored in Next.js 15+
const nextConfig: NextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pino", "pino-pretty"],
  },
};
```

## RIGHT
```ts
// next.config.ts — correct for Next.js 15+
const nextConfig: NextConfig = {
  serverExternalPackages: ["pino", "pino-pretty"],
};
```

## NOTES
- As of Next.js 16, `pino` and `pino-pretty` are on the auto-opted-in list and may not need explicit config
- Being explicit prevents breakage if the auto-list changes
- Turbopack in Next.js 16.1 fixed a bug where transitive deps of externalized packages weren't properly handled
