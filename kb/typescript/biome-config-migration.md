---
tech: typescript
tags: [biome, config, migration, linting]
severity: medium
---
# Biome 2.x config format changed significantly from 2.0 schema

## PROBLEM
Biome 2.x (2.2+) changed several config keys from the 2.0 schema. Using the old format causes config parse errors: `organizeImports` moved to `assist.actions.source.organizeImports`, `files.ignore` became `files.includes` with negation patterns, and the ignore pattern syntax dropped trailing `/**` for folders. The fix is easy but the errors are confusing.

## WRONG
```json
{
  "$schema": "https://biomejs.dev/schemas/2.0/schema.json",
  "organizeImports": { "enabled": true },
  "files": {
    "ignore": ["src/lib/components/ui/**"]
  }
}
```

## RIGHT
```bash
# Auto-migrate the config
npx biome migrate --write
```
```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.8/schema.json",
  "assist": { "actions": { "source": { "organizeImports": "on" } } },
  "files": {
    "includes": ["**", "!**/src/lib/components/ui"]
  }
}
```

## NOTES
- Always run `npx biome migrate --write` after installing a new Biome version
- Biome 2.2+ does not need `/**` suffix for folder exclusions
- Biome has false positives for "unused imports" in Svelte files (imports used in template). Disable `noUnusedImports` and `noUnusedVariables` for `*.svelte` via overrides.
