---
tech: biome
tags: [biome, biome-2-6, markdown, formatter, frontmatter, yaml, claude-code, rules, upgrade]
severity: high
---
# Biome 2.6 formats Markdown by default and corrupts YAML frontmatter globs

## PROBLEM
From 2.6, `biome check .` / `biome format --write .` also format `.md` files. The Markdown
formatter treats YAML frontmatter as Markdown, so `*` in a glob reads as emphasis and is rewritten
to `_`. A `.claude/rules/*.md` file scoped with `paths:` therefore has its globs mangled
(`**/*.test.*` becomes `**/_.test._`) and the rule silently stops matching anything. On the
upgrade it first shows up as ~100 `format` diagnostics on Markdown; running `--write` to "fix"
them is what does the damage.

## WRONG
```jsonc
// biome.jsonc after upgrading to 2.6 with no Markdown setting
{ "formatter": { "enabled": true } }
```
```diff
 paths:
-  - "**/*.test.*"
+  - "**/_.test._"
```

## RIGHT
```jsonc
{
  "$schema": "https://biomejs.dev/schemas/2.6.8/schema.json",
  "formatter": { "enabled": true },
  // Biome 2.6 formats Markdown by default and rewrites frontmatter globs.
  "markdown": { "formatter": { "enabled": false } }
}
```

## NOTES
- Run `biome migrate --write` after the bump: the `$schema` URL in every `biome.json(c)`
  (including nested `"extends": "//"` configs) must match the installed version or the config
  reports a deserialize error.
- 2.6 also promoted many nursery rules into `recommended` (e.g. `noComponentHookFactories`,
  `noCommaOperator`, `useDomNodeTextContent`) and broadened `noDescendingSpecificity` to
  nested/`@layer` CSS. Expect new findings; the specificity rule only compares the last
  compound selector, so check whether the two selectors can match the same element before
  reordering CSS. `useDomNodeTextContent` also fires on Playwright `Locator.innerText()`.
