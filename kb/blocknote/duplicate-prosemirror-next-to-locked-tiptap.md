---
tech: blocknote
tags: [blocknote, tiptap, prosemirror, pnpm, lockfile, duplicate-dependency, monorepo]
severity: high
---
# Duplicate ProseMirror next to a locked Tiptap

## PROBLEM
BlockNote 0.56 requires `prosemirror-view ^1.42.5`. In a pnpm monorepo whose lockfile already had Tiptap 3.31.4 resolving `prosemirror-view` 1.42.3, `pnpm add @blocknote/*` left Tiptap on the old resolution and installed a second copy. The result was two copies each of `prosemirror-model`, `prosemirror-view` and `prosemirror-transform`.

Two ProseMirror instances break editors silently: `instanceof` checks between Node, Schema, Plugin and Transaction objects from different copies fail, so plugins, keymaps and paste handling stop working with no install error and often no console error. The install, typecheck and build all pass.

## WRONG
```bash
pnpm --filter dashboard add @blocknote/core @blocknote/react @blocknote/shadcn
# done -- ships with two prosemirror-view copies

pnpm dedupe   # also fixes it, but churns unrelated lockfile entries
              # (@smithy/*, pg-protocol, ws, @types/hast in the 2026-10 spike)
```

## RIGHT
```bash
pnpm --filter dashboard add @blocknote/core @blocknote/react @blocknote/shadcn

# Detect: more than one version listed means duplicate instances
pnpm why prosemirror-model
pnpm why prosemirror-view

# Fix: targeted re-resolution of just the ProseMirror core
pnpm update prosemirror-view prosemirror-model prosemirror-transform

# Verify: exactly one version each
pnpm why prosemirror-model prosemirror-view prosemirror-transform
```

## NOTES
- Applies whenever an editor built on ProseMirror (BlockNote, Tiptap, Remirror, Milkdown) is added beside another one already in the lockfile. Check `pnpm why` after every editor-package add or bump.
- A `pnpm.overrides` pin is an alternative, but it must then be bumped by hand when either editor's floor moves.
- Observed on BlockNote 0.56.0, Tiptap 3.31.4, pnpm 12, 2026-10-19.
