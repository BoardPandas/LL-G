---
tech: react
tags: [radix, fieldset, disabled, read-only, forms]
severity: medium
---
# A disabled fieldset does not stop a forwarded pointer event from opening a Radix trigger

## PROBLEM
To make a whole section read-only (a locked record) the quick fix is `<fieldset disabled>`. Native buttons and inputs inside it stop responding to real user clicks. But a "click anywhere on the card to edit" wrapper that forwards the click by dispatching `pointerdown`/`pointerup` on the first button bypasses that: Radix triggers open on the synthetic pointer event, and the menu inside is fully usable.

## WRONG
```tsx
<fieldset disabled={locked}>
  <EditCard clickToEdit>{/* forwards pointer events to its first button */}
    <StatusSelect value={status} onChange={save} />
  </EditCard>
</fieldset>
```

## RIGHT
```tsx
<fieldset disabled={locked}>
  <EditCard clickToEdit={!locked}>
    <StatusSelect value={status} onChange={save} disabled={locked} />
  </EditCard>
</fieldset>
```

## NOTES
Keep the fieldset for the native inputs, but treat it as a floor. Test the locked state by clicking the card, not only the control.
