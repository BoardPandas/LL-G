---
tech: react
tags: [prosemirror, tiptap, drag-and-drop, ondrop, event-propagation, attachments, jsdom]
severity: high
---
# ProseMirror handleDrop does not stop a drop bubbling to a React onDrop on its wrapper

## PROBLEM
A Tiptap/ProseMirror editor often sits inside a card that has its own drop zone. When `editorProps.handleDrop` returns true, ProseMirror only calls `event.preventDefault()`. It does not call `stopPropagation()`, so the native drop keeps bubbling and the wrapper's React `onDrop` runs too.

If both handlers attach files, every file dropped on the text is attached twice. A drop on the wrapper's edge, outside the text, attaches once, which makes the bug look intermittent. Nothing errors. The duplicates also upload, so the second copy is stored and sent as well.

## WRONG
```tsx
// Editor hook
handleDrop: (_view, event) => {
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length) { addFiles(files); return true } // still bubbles
  return false
},

// Wrapper
<div onDragOver={(e) => e.preventDefault()}
     onDrop={(e) => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)) }}>
  <EditorContent editor={editor} />
</div>
```

## RIGHT
```tsx
// The wrapper's drop zone is the only place that attaches dropped files.
// The editor claims file drops so ProseMirror doesn't also insert the file
// path or URL some drag sources send alongside the file.
handleDrop: (_view, event) => Boolean(event.dataTransfer?.types.includes("Files")),
```

## NOTES
- Checking `e.defaultPrevented` in the wrapper also works, but it makes ownership implicit. One owner is easier to read.
- Keep the claim. If `handleDrop` returns false, ProseMirror parses the drop's `text/plain` and inserts the file path into the document.
- Testing in jsdom: ProseMirror's drop handler calls `view.posAtCoords` first and returns before `handleDrop` when that is null, which it always is without layout. Stub `editor.view.posAtCoords = () => ({ pos: 1, inside: -1 })`, then `fireEvent.drop(proseMirrorEl, { dataTransfer: { files, types: ["Files"], getData: () => "" } })` reproduces the double attach.
- Related: `kb/jest/jsdom-has-no-dragevent-so-fireevent-drag-events-silently-drop-clientx.md`.
