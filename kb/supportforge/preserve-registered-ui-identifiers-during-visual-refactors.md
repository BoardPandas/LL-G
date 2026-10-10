---
tech: supportforge
tags: [ui, refactoring, identifiers, registry, ci, react]
severity: medium
---
# Preserve registered UI identifiers during visual refactors

## PROBLEM

A visual refactor can compile, pass component tests, and render correctly while removing registered UI identifiers. SupportForge's separate UI identifier guard compares source attributes against `docs/design-system/UIC_MASTER_LIST.md`. Removing a wrapper or replacing a heading without carrying its identifier onto the equivalent element leaves a stale registry entry and blocks CI promotion.

On 2026-10-10, converting staff sign-in settings into a disclosure removed `STFHDR0005` and `STFTTL0005`. Dashboard tests, type checking, and the production build passed, but CI 38086206069 failed the registry guard. Restoring those identifiers to the summary and title made the guard pass with 218 identifiers used and declared.

## WRONG

```tsx
// The previous header and title had registered identifiers.
// Replacing their markup drops the identifiers even though the UI still works.
<details>
  <summary>Staff sign-in settings</summary>
  <StaffSignInSettings />
</details>
```

```powershell
# These checks do not replace the repository's separate identifier guard.
pnpm --dir dashboard type-check
pnpm --dir dashboard build
```

## RIGHT

```tsx
// Keep each identifier on its equivalent semantic element.
<details>
  <summary id="STFHDR0005">
    <span id="STFTTL0005">Staff sign-in settings</span>
  </summary>
  <StaffSignInSettings />
</details>
```

```powershell
# Run from the repository root before committing a UI refactor.
pnpm uic:check
```

## NOTES

- Inspect existing `id`, `data-uic`, `data-uic-id`, and supported `slotId` declarations before replacing a component's markup. Preserve identifiers when the corresponding UI function remains.
- If an element is intentionally retired, reconcile its registry entry and references in the same change. Do not delete registry entries merely to make a visual refactor pass.
- A passing guard checks registry consistency; it does not replace browser review, accessibility checks, or verification that the identifier remains attached to the correct element.
- The existing `scripts/validate-uic.js` guard already detected this defect. This lesson adds the omitted local verification step; it does not require another guard.
- Evidence: [failed CI](https://github.com/BoardPandas/supportforge-platform/actions/runs/38086206069), [identifier restoration](https://github.com/BoardPandas/supportforge-platform/commit/1bb419542cc39f8436a96e0481b51f2eb2c1f4c9), and [passing follow-up CI](https://github.com/BoardPandas/supportforge-platform/actions/runs/38086745947).
