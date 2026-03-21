---
tech: svelte
tags: [imports, dead-code, root-component, app-crash, refactoring]
severity: high
---
# Dead import in root component crashes entire app

## PROBLEM
In Svelte, if your root `App.svelte` (or layout component) imports a deleted or broken component, the ENTIRE app fails to mount -- not just the route that uses that component. Unlike lazy-loaded frameworks, Svelte eagerly resolves all imports at module load time. A single dead import in the router kills every view, even unrelated ones.

## WRONG
```svelte
<!-- App.svelte -->
<script>
import Dashboard from "./views/Dashboard.svelte";
import Review from "./views/Review.svelte";      // DELETED FILE
import Settings from "./views/Settings.svelte";
</script>

<!-- Even Dashboard and Settings are now broken because the whole module fails to load -->
{#if view === "dashboard"}
  <Dashboard />
{:else if view === "review"}
  <Review />
{:else if view === "settings"}
  <Settings />
{/if}
```

## RIGHT
```svelte
<!-- App.svelte -->
<script>
import Dashboard from "./views/Dashboard.svelte";
// Review.svelte was deleted -- remove the import AND the route
import Settings from "./views/Settings.svelte";
</script>

{#if view === "dashboard"}
  <Dashboard />
{:else if view === "settings"}
  <Settings />
{/if}
```

## NOTES
- Always grep App.svelte / layout files for references to deleted components.
- This also applies to components that import from deleted modules transitively -- if ReviewSession.svelte imports from a deleted fsrs.ts, and App.svelte imports ReviewSession.svelte, the whole app crashes.
- Consider adding route-level error boundaries or dynamic imports for large apps to isolate failures.
