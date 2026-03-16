---
tech: nextjs
tags: [biome, config, migration, linting]
severity: medium
---
# Biome 2.x removed organizeImports top-level key

## PROBLEM
Biome v2 removed the `organizeImports` top-level configuration key. If your biome.json contains `"organizeImports": { "enabled": true }`, Biome 2.x will reject the config and refuse to run.

## WRONG
```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "organizeImports": {
    "enabled": true
  }
}
```

## RIGHT
```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "assist": {
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  }
}
```

Or simply remove the key — import organizing is handled differently in v2.

## NOTES
- Biome v1 → v2 migration: run `npx @biomejs/biome migrate` to auto-fix config
- The v1 `include`/`ignore` fields were also replaced by a single `includes` field in v2
