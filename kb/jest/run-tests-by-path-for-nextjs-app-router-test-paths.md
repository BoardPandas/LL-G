---
tech: jest
tags: [jest, nextjs, app-router, runtestsbypath, pnpm]
severity: medium
---
# Use runTestsByPath for Next.js app-router test paths

## PROBLEM
Jest treats positional test paths as regular-expression patterns. Next.js app-router paths commonly contain parentheses for route groups and square brackets for dynamic segments, so an exact file that exists can produce `No tests found`. The failure looks like a missing or ignored test instead of path-pattern interpretation.

## WRONG
```bash
pnpm --filter supportforge-dashboard exec jest --runInBand \
  'src/app/(dashboard)/rmm/devices/[deviceId]/__tests__/device-detail-client.test.tsx'
```

## RIGHT
```bash
pnpm --filter supportforge-dashboard exec jest --runInBand --runTestsByPath \
  'src/app/(dashboard)/rmm/devices/[deviceId]/__tests__/device-detail-client.test.tsx'
```

## NOTES
With pnpm, prefer `pnpm ... exec jest` for this exact invocation. An extra `--` after a package `test` script can itself be forwarded to Jest and turn later options into positional patterns; that separate pnpm pass-through gotcha is already documented in the pnpm knowledge slice.
