---
tech: typescript
tags: [vitest, jsdom, testing, dependencies]
severity: medium
---
# Vitest jsdom environment requires separate installation

## PROBLEM
When using `environment: "jsdom"` in vitest.config.ts, the `jsdom` package must be installed as a separate devDependency. Vitest does not bundle it or list it as a required dependency. Tests fail with `Cannot find package 'jsdom'` error.

## WRONG
```bash
pnpm add -D vitest
# vitest.config.ts has environment: "jsdom"
pnpm test  # FAILS: Cannot find package 'jsdom'
```

## RIGHT
```bash
pnpm add -D vitest jsdom
# Now environment: "jsdom" works
pnpm test  # PASSES
```

## NOTES
- Same applies to other environments like `happy-dom` -- they must be installed separately
- The error message is clear but it's easy to forget during initial setup
