---
tech: claude-code
tags: [CLAUDE.md, imports, context-window, always-on, documentation, silent-failure]
severity: medium
---
# An @import in CLAUDE.md only works at column 0, and mid-line it is silently just prose

## PROBLEM
`CLAUDE.md` imports another file with `@path/to/file` on a line of its own. The same token written **inside a sentence** is not an import. It renders as prose, the target is never read, and nothing warns.

The failure is invisible from both ends. The line reads like a working import to whoever wrote it, so they stop duplicating that content into `CLAUDE.md` on the assumption it is always available. And the model never sees the file, so it cannot report that it is missing.

Found in a Next.js repo whose `.claude/CLAUDE.md` opened with:

```markdown
See @README.md for full project details, design system colors, and architecture diagrams.
```

That README was 24 KB and had never once loaded. Sessions doing UI work believed the design system was in context; it was not. Ground truth is cheap to check and nobody had checked: list the files appearing under `Contents of <path>` headers in the model's own context.

The trap is that the obvious fix is also silent, in the opposite direction. Moving the token to column 0 makes it a real import, and that README was ~6k tokens, which would have more than doubled always-on context for every session including ones that never touch the UI. Whether the right fix is "make it an import" or "make it plainly a link" depends on the size of the target and how often it is actually needed. Decide, do not just left-align it.

## WRONG
```markdown
See @README.md for full project details and architecture diagrams.
```
Result: prose. `README.md` never loads, and the omission is undetectable from inside the session.

## RIGHT
```markdown
<!-- Genuinely want it in every session, and it is small: -->
@docs/api-conventions.md

<!-- Just a pointer, and the target is large or rarely needed: -->
See [README.md](../README.md) for architecture diagrams. (Deliberately a link, not an
`@` import: it is ~6k tokens and most sessions never need it.)
```

## NOTES
- Assert it mechanically. A checker that only matches `/^@(\S+)/` will not flag this, because there is no malformed import to find, just an ordinary sentence. Warn on `/\S\s*@([A-Za-z0-9_./-]+\.md)\b/` (an `@file.md` with non-whitespace before it on the same line). Implemented in BP `practices/claude-config/check-claude-wiring.mjs`.
- The same checker must look at **both** `CLAUDE.md` and `.claude/CLAUDE.md`. Claude Code loads either; a guard hardcoding the root path reports a repo using the `.claude/` location as ~940 always-on tokens when the real figure is ~5,100.
- Verify by inspection, never by intent: the files listed under `Contents of <path>` in the model's context are ground truth for what loaded. Applies equally to rules scoping, see `cursor-frontmatter-keys-ignored.md`.
- When an import is genuinely too expensive to always-load, the pointer that replaces it has no trigger and will mostly be ignored. If the target carries a real constraint, inline the five to ten lines that carry it at the point of use rather than linking to it.
