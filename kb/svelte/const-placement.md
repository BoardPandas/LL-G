---
tech: svelte
tags: [svelte5, const, template, compilation]
severity: medium
---
# {@const} tag placement restriction in Svelte 5

## PROBLEM
In Svelte 5, `{@const}` can only be the immediate child of `{#snippet}`, `{#if}`, `{:else if}`, `{:else}`, `{#each}`, `{:then}`, `{:catch}`, `<svelte:fragment>`, `<svelte:boundary>`, or `<Component>`. Using it directly inside a regular HTML element like `<main>` or `<div>` causes a compilation error.

## WRONG
```svelte
<main>
  {@const ViewComponent = views[currentView()]}
  <ViewComponent />
</main>
```

## RIGHT
```svelte
<!-- Option 1: Use {#if} blocks instead -->
<main>
  {#if currentView() === "dashboard"}
    <Dashboard />
  {:else if currentView() === "review"}
    <Review />
  {/if}
</main>

<!-- Option 2: Compute in script, use in template -->
<script>
  let ViewComponent = $derived(views[currentView()]);
</script>
<main>
  <ViewComponent />
</main>
```

## NOTES
- This is a Svelte 5 change from Svelte 4, where `{@const}` had fewer restrictions
- The error message is clear but the valid placement list is long and easy to forget
