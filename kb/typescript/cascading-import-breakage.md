---
tech: typescript
tags: [imports, refactoring, dead-code, module-deletion, blast-radius]
severity: high
---
# Cascading import breakage on module deletion

## PROBLEM
When deleting files as part of a refactor, the blast radius extends far beyond the files you delete. If Module A imports from Module B which imports from Module C, deleting C breaks both B and A. The handoff doc may list 10 files to delete, but the actual count can be 25+ once you trace the full import chain. Missing this causes a wave of build failures that are tedious to untangle after the fact.

## WRONG
```bash
# Delete the files listed in the plan
rm -rf src/lib/import/
rm -f src/lib/db/queries/cards.ts
rm -f src/lib/db/queries/decks.ts
# Run build... 15 files now have broken imports
# Scramble to fix them one by one
```

## RIGHT
```bash
# BEFORE deleting anything, trace the full dependency chain
grep -r "from.*import/" src/ --include="*.ts" --include="*.svelte" -l
grep -r "from.*queries/cards" src/ --include="*.ts" --include="*.svelte" -l
grep -r "from.*queries/decks" src/ --include="*.ts" --include="*.svelte" -l
# For each file found, check if IT is also imported by other files
# Build the full deletion + fix list BEFORE removing anything
# Then delete and fix in one pass
```

## NOTES
- This is especially bad in Svelte/SvelteKit apps where views import from query layers that import from other query layers.
- A query file that references a dropped DB table is just as broken as a deleted file -- trace SQL table references too.
- Stats/analytics modules are easy to miss because they aggregate across multiple data sources (cards, builtin_items, review_log, etc.).
- When a migration drops tables, grep for every table name in the codebase, not just the query files you know about.
