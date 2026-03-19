---
tech: svelte
tags: [biome, linting, imports, svelte5]
severity: medium
---
# Biome reports false unused imports in Svelte files

## PROBLEM
Biome's `noUnusedImports` and `noUnusedVariables` rules report false positives in `.svelte` files because Biome analyzes only the `<script>` block and cannot see that imports are used in the template markup. Running `biome check --write` will DELETE these imports, breaking the component.

## WRONG
```json
// biome.json -- no override for Svelte files
{
  "linter": {
    "rules": { "recommended": true }
  }
}
```
```bash
biome check --write  # DELETES component imports used in template!
```

## RIGHT
```json
{
  "linter": {
    "rules": { "recommended": true }
  },
  "overrides": [
    {
      "includes": ["**/*.svelte"],
      "linter": {
        "rules": {
          "correctness": {
            "noUnusedImports": "off",
            "noUnusedVariables": "off"
          }
        }
      }
    }
  ]
}
```

## NOTES
- This affects all Svelte component imports, event handler functions, and reactive variables used only in markup
- The `--write` flag makes this dangerous because it auto-removes "unused" imports that are actually needed
- May improve in future Biome versions as Svelte support matures
