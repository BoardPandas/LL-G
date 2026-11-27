---
tech: react
tags: [editor, async, race-condition, drafts, tiptap]
severity: high
---
# Clearing the editor after a send clears whatever is in it now, not what was sent

## PROBLEM
A composer keeps a draft per mode and shares one editor. Send is async. The success handler calls `editor.commands.clearContent()`. If mode switching is still possible during the request (tabs not disabled, a hotkey still live), the user can switch and start typing; when the first send lands, the handler clears the new text. TipTap emits an update for `clearContent`, so the draft writer sees an empty editor and deletes the stored draft for the mode now on screen.

## WRONG
```tsx
const send = async () => {
  await post(endpointFor(mode), editor.getHTML())
  editor.commands.clearContent() // clears the current mode, whichever that is now
  clearDraft(mode)
}
```

## RIGHT
```tsx
const send = async () => {
  if (sendingRef.current || anyUploading) return // the hotkey path must refuse too
  sendingRef.current = true
  const sentMode = mode
  try {
    await post(endpointFor(sentMode), editor.getHTML())
    if (currentMode() === sentMode) editor.commands.clearContent()
    clearDraft(sentMode)
  } finally { sendingRef.current = false }
}
// and: disable the mode tabs and ignore mode hotkeys while sendingRef.current
```

## NOTES
Do both: refuse the switch and make the success path mode-aware. A keyboard send (Ctrl+Enter) usually bypasses the disabled state of the button, so put the guards in `send()` itself.
