---
tech: blocknote
tags: [blocknote, server-util, nodejs, commonjs, ssr, html-export, email, markdown, react]
severity: high
---
# @blocknote/server-util is unfit for a CommonJS Node API

## PROBLEM
`@blocknote/server-util` looks like the obvious way to render stored BlockNote JSON to HTML or Markdown on the server. In a CommonJS Express API it fails in five ways, some silent:

- `require()` fails with `ee.default.extend is not a function` (CJS/ESM interop of Tiptap).
- It needs `y-prosemirror` and `y-protocols` at runtime but does not install them.
- With React custom blocks, the call returned successfully and then the process crashed: an uncaught `window.event` TypeError from react-dom's scheduler, fired after the fact. Tests that only await the result pass.
- Its HTML is class-based (`bn-*` classes, a mangled `classname=` attribute) with no inline styles, so it renders unstyled in email clients -- not email-safe.
- Custom-block Markdown loses block separation (blocks run together).

## WRONG
```ts
// CommonJS API (Express)
import { ServerBlockNoteEditor } from '@blocknote/server-util';
const editor = ServerBlockNoteEditor.create({ schema });
const html = await editor.blocksToFullHTML(doc.blocks);   // crashes on require, or later
await sendEmail({ html });                                // unstyled bn-* markup
```

## RIGHT
```ts
// A small pure-TS walker over BlockNote's JSON -- no editor, no DOM, no React
type Block = { type: string; props: Record<string, unknown>; content?: Inline[]; children: Block[] };

function blockToHtml(b: Block): string {
  switch (b.type) {
    case 'paragraph': return `<p style="margin:0 0 12px">${inline(b.content)}</p>${children(b)}`;
    case 'heading':   return `<h${b.props.level} style="...">${inline(b.content)}</h${b.props.level}>`;
    // ...one case per block type you allow, including your custom blocks
    default: throw new Error(`Unhandled block type: ${b.type}`);  // fail loudly
  }
}
```

## NOTES
- The walker owns escaping, inline styles for email, and Markdown block separation, and it is unit-testable without a DOM.
- Fail on unknown block types rather than dropping them, so a new custom block cannot vanish from exports silently.
- If you must use server-util, run it in an ESM worker without React custom blocks and still do not use its HTML for email.
- Observed on BlockNote 0.56.0 in a CommonJS Node/Express API, 2026-10-19.
