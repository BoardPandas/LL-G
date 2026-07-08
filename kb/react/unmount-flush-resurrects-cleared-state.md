---
tech: react
tags: [localstorage, unmount, cleanup, autosave, drafts, custom-events]
severity: medium
---
# Unmount flush resurrects localStorage state cleared by another component

## PROBLEM
A hook that autosaves component state to localStorage usually flushes one final save in its unmount cleanup so the tail of a debounce window isn't lost on fast navigation. If a DIFFERENT component can clear that storage key (e.g. a tab strip's "discard draft" confirm that clears the key and then navigates away), the clear happens BEFORE the unmount — so the exit flush re-saves the just-discarded state from the still-populated component. The user explicitly discarded a draft, and it silently reappears the next time the view opens. Nothing errors; the bug only shows up on the discard-the-active-view path, because discarding an inactive view has no mounted component to flush.

## WRONG
```tsx
// Autosave hook: debounced saves + flush-on-unmount.
React.useEffect(() => {
  return () => {
    clearTimeout(timerRef.current)
    saveDraft(id, readCurrentState()) // final flush
  }
}, [saveDraft])

// Elsewhere (tab strip): discard = clear storage, close, navigate.
onConfirmDiscard={() => {
  localStorage.removeItem(draftKey(id)) // cleared...
  closeTab(id)
  router.push('/list') // ...then the editor unmounts and the flush RE-SAVES it
}}
```

## RIGHT
```tsx
// Discard helper: clear storage AND signal any mounted editor to stand down.
export function discardDraft(id: string) {
  localStorage.removeItem(draftKey(id))
  window.dispatchEvent(new CustomEvent('draft-discard', { detail: String(id) }))
}

// Autosave hook: listen for the signal; a discarded editor stops persisting.
React.useEffect(() => {
  const onDiscard = (e: Event) => {
    if ((e as CustomEvent<string>).detail !== String(id)) return
    discardedRef.current = true          // makes writeNow()/flush a no-op
    clearTimeout(timerRef.current)
    editor?.commands.clearContent()      // keep UI consistent too
  }
  window.addEventListener('draft-discard', onDiscard)
  return () => window.removeEventListener('draft-discard', onDiscard)
}, [editor, id])

const writeNow = () => {
  if (discardedRef.current) return       // exit flush can no longer resurrect
  saveDraft(id, readCurrentState())
}
```

## NOTES
General rule: when state is persisted from INSIDE a component but can be cleared from OUTSIDE it, the clear must also tell the live component to stand down — otherwise every exit-flush path (unmount cleanup, beforeunload, visibilitychange) will resurrect the cleared state. Reset the discarded flag when the component re-initializes for a new entity (e.g. on id change). Found in SupportForge's ticket composer draft persistence (useComposerDraft + TicketTabs discard confirm).
