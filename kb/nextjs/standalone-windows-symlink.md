---
tech: nextjs
tags: [windows, build, standalone, symlink, nssm, deployment]
severity: high
---
# Standalone mode on Windows requires Developer Mode for symlinks

## PROBLEM
Setting `output: "standalone"` in `next.config.ts` causes the build to fail on Windows with `EPERM: operation not permitted, symlink`. Next.js standalone mode creates symlinks to node_modules during the build trace phase. Windows requires either Developer Mode enabled or administrator privileges for symlink creation. The error surfaces late in the build (after compilation succeeds), making it seem like a build infrastructure problem.

## WRONG
```typescript
// next.config.ts
const nextConfig: NextConfig = {
  output: "standalone", // Fails on Windows without Developer Mode
  serverExternalPackages: ["better-sqlite3"],
};
```

```
> next build
✓ Compiled successfully
✓ Generating static pages
⚠ Failed to copy traced files [Error: EPERM: operation not permitted, symlink ...]
```

## RIGHT
```typescript
// next.config.ts -- for local-only Windows deployment, skip standalone
const nextConfig: NextConfig = {
  // output: "standalone", // Requires Windows Developer Mode for symlinks
  serverExternalPackages: ["better-sqlite3"],
};
// Use `next start` from the project root instead of standalone server.js
```

Or enable Developer Mode:
```powershell
# Run as Administrator
New-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock' `
  -Name 'AllowDevelopmentWithoutDevLicense' -Value 1 -PropertyType DWord -Force
```

## NOTES
- For local-only apps (LAN access, Windows service via NSSM), standalone mode is unnecessary. `next start` works fine from the project root.
- Standalone mode is primarily useful for Docker/container deployments where you want a minimal file set.
- The error only appears during the trace/copy phase, after the build has already compiled successfully.