---
tech: tailwind-css
tags: [v4, vite, workspace, monorepo, pnpm, import, resolution]
severity: high
---
# Tailwind 4.x @import resolves from the package directory, not the consuming app

## PROBLEM
In Tailwind CSS 4.x with `@tailwindcss/vite`, if a workspace package's CSS file uses `@import "tailwindcss"`, the Vite plugin resolves `tailwindcss` from that package's directory -- not from the consuming app. If `tailwindcss` is only a devDependency of the app (not the shared package), the build fails with a misleading error pointing at the wrong location.

## ERROR
```
[@tailwindcss/vite:generate:build] Can't resolve 'tailwindcss' in '/repo/packages/ui/src/styles'
```

## WRONG
```jsonc
// packages/ui/package.json -- no tailwindcss dependency
{
  "exports": { "./styles": "./src/styles/index.css" }
}

// apps/windrunner/package.json -- has tailwindcss, but resolution fails
{
  "devDependencies": { "tailwindcss": "^4.1.13", "@tailwindcss/vite": "^4.1.13" }
}

// packages/ui/src/styles/index.css
@import "tailwindcss";  // Vite resolves from packages/ui/ -- not found
```

## RIGHT
```jsonc
// packages/ui/package.json -- add tailwindcss as devDependency
{
  "devDependencies": { "tailwindcss": "^4.1.13" }
}
```

Then run `pnpm install` to update the lockfile.

## NOTES
- This is specific to Tailwind CSS 4.x with the `@tailwindcss/vite` plugin. Tailwind 3.x uses a different config model.
- In pnpm workspaces, peer/dev dependencies are not hoisted by default. Each package resolves from its own `node_modules`.
- The error message points at the shared package directory, not the app -- which makes it confusing since you might think the app config is wrong.
- Same pattern applies to any workspace package that has CSS importing `tailwindcss` -- it needs its own dependency.
