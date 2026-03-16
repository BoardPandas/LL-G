---
tech: nextjs
tags: [biome, tailwind, css, linting, tailwind-v4]
severity: high
---
# Biome cannot parse Tailwind CSS v4 syntax

## PROBLEM
Biome 2.x cannot parse Tailwind CSS v4's custom at-rules (`@theme inline`, `@custom-variant`, `@apply`). Even with `css.linter.enabled: false` and `css.formatter.enabled: false` in biome.json, Biome still parses CSS files and reports parse errors. This causes `biome check` to fail.

## WRONG
```json
// biome.json — this does NOT prevent CSS parse errors
{
  "css": {
    "linter": { "enabled": false },
    "formatter": { "enabled": false }
  }
}
```

## RIGHT
```json
// biome.json — exclude CSS files entirely
{
  "files": {
    "includes": ["src/**", "worker/**", "!**/*.css"]
  }
}
```

## NOTES
- Tailwind CSS v4 uses CSS-first configuration with `@theme` blocks — no tailwind.config.js
- Biome's CSS parser does not understand `@theme inline`, `@custom-variant`, or `@apply` as of Biome 2.4
- Also exclude `src/components/ui/**` if using shadcn/ui — generated components don't match project lint rules
- Let Tailwind/PostCSS handle all CSS processing
