---
tech: svelte
tags: [svelte5, runes, state, typescript]
severity: medium
---
# Svelte 5 runes require .svelte.ts file extension

## PROBLEM
Svelte 5 runes (`$state`, `$derived`, `$effect`) only work in `.svelte` files and `.svelte.ts` files. Using them in regular `.ts` files silently fails or produces compilation errors. This is especially confusing for stores/state modules that are pure TypeScript.

## WRONG
```typescript
// stores/navigation.ts -- WRONG extension
let state = $state({ current: "dashboard" }); // Error: $state is not defined
```

## RIGHT
```typescript
// stores/navigation.svelte.ts -- correct extension
let state = $state({ current: "dashboard" }); // Works
```

## NOTES
- This applies to all runes: $state, $derived, $effect, $props, $bindable
- The .svelte.ts extension tells Vite to process the file through the Svelte compiler
- IDE support (VS Code + Svelte extension) also depends on the correct extension
