---
tech: react
tags: [editor, async, race-condition, tiptap, prosemirror]
severity: high
---
# An async insert that outlives a mode switch lands in the wrong document

## PROBLEM
An editor has modes with different audiences and one shared editor instance whose content is swapped per mode. A picker starts a request whose scope depends on the mode (an internal-only version of a knowledge-base page), then awaits. Nothing disables the mode tabs while it is in flight. The user switches mode; the picker closes; the promise still resolves and inserts internal content into the public document. The saved insert position belongs to the previous document, so it can also throw `RangeError: Position N out of range`.

## WRONG
```tsx
const insert = async (page) => {
  const html = await api.insert(page.id, { scope: scopeFor(mode) })
  editor.chain().insertContentAt(from, html).run() // mode and document may have changed
}
```

## RIGHT
```tsx
const docVersion = useRef(0) // bump on every mode switch and record change

const insert = async (page) => {
  const startedMode = modeRef.current
  const startedDoc = docVersion.current
  const html = await api.insert(page.id, { scope: scopeFor(startedMode) })
  if (modeRef.current !== startedMode || docVersion.current !== startedDoc) return null
  const at = Math.min(from, editor.state.doc.content.size)
  editor.chain().insertContentAt(at, html).run()
}
```

## NOTES
Comparing the mode alone is not enough: switching away and back is the same mode but a different document, which is why the counter exists. The same shape applies to streamed AI drafts, uploads and anything else that writes into an editor after an await.
