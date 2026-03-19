---
tech: typescript
tags: [vite, alias, path, build, svelte]
severity: medium
---
# Vite $lib path alias must be in vite.config.ts, not just tsconfig.json

## PROBLEM
Having a `$lib` path alias only in `tsconfig.json` works for TypeScript type checking and IDE support, but `vite build` fails with "Rollup failed to resolve import" because Vite/Rollup uses its own module resolution. The alias must also be defined in `vite.config.ts`.

## WRONG
```json
// tsconfig.json -- alias here only
{
  "compilerOptions": {
    "paths": { "$lib/*": ["./src/lib/*"] }
  }
}
```
```bash
pnpm build  # FAILS: Rollup failed to resolve import "$lib/..."
```

## RIGHT
```typescript
// vite.config.ts -- alias must be here too
import path from "node:path";
export default defineConfig({
  resolve: {
    alias: {
      $lib: path.resolve("./src/lib"),
    },
  },
});
```

## NOTES
- SvelteKit handles this automatically via its own Vite plugin
- Plain Svelte + Vite requires manual alias configuration in both files
- `pnpm dev` may work (Vite dev server is more lenient) but `pnpm build` will fail
