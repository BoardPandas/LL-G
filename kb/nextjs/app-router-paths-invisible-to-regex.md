---
tech: nextjs
tags: [app-router, route-groups, dynamic-segments, regex, tooling, markdown, static-analysis, false-negative]
severity: high
---
# App Router paths are invisible to path-matching regexes, so tooling passes them by never seeing them

## PROBLEM

Any tool that pulls file paths out of text with a regex -- a doc-citation
checker, a link linter, a codemod, a coverage or ownership mapper -- reaches for
a character class like `[A-Za-z0-9_./-]`. That class covers every path in a
normal repo.

It does not cover a Next.js App Router path. Route groups add `(dashboard)` and
dynamic segments add `[ticketId]`, `[...path]`, `[[...path]]`. Against
`dashboard/src/app/(dashboard)/settings/page.tsx` the match dies at the `(`,
leaving `dashboard/src/app/` -- a fragment with no extension, which the pattern
then rejects as not-a-path.

The failure mode is what makes this HIGH. The path is not reported as broken; it
is not reported at all. **Passing by never matching is byte-identical to passing
by being valid.** The tool reads green on precisely the paths it is blind to, and
the blindness grows with how much of the app uses the App Router.

We hit this on a doc-citation gate that had just been ratcheted to a floor of
zero. Zero dead citations, zero out-of-bounds line ranges, green in CI. Teaching
the pattern about App Router syntax surfaced six genuinely dead references to
dashboard pages that had moved months earlier. They had never once been checked.

Then the fix has its own trap, because in Markdown `(`, `)`, `[` and `]` are link
punctuation. Just adding them to the character class is wrong in a way that is
easy to *mis*-diagnose:

- A trailing `)` is safe, contrary to intuition. In `[x](src/foo.ts)` the pattern
  must still END in an extension, so it backtracks off the paren on its own.
- `](` in the MIDDLE is not safe, and `[path](path)` -- a self-link, the most
  common citation form in hand-written docs -- is exactly that shape. A flat
  class containing both characters matches straight through the middle and
  returns `src/foo.ts](src/foo.ts` as a single path. On our corpus that one
  mistake produced 65 bogus dead paths, each one a real file cited correctly.

So the flat widening trades a silent false negative for a loud false positive,
and the misleading part is that the case you would think to test by hand -- the
trailing paren -- passes.

## WRONG

```js
// 1. The original: no parens or brackets, so every App Router path is skipped
//    silently. Not flagged, not counted, never matched.
const ORIGINAL = /(?<![\w/])(?:src|dashboard\/src)\/[A-Za-z0-9_./-]+\.(?:ts|tsx)\b/g;

'dashboard/src/app/(dashboard)/settings/page.tsx'.match(ORIGINAL);
// -> null      no extension survives the '(', so this is simply not a citation

// 2. The naive fix: dump the four characters into the class.
const FLAT = /(?<![\w/])(?:src|dashboard\/src)\/[A-Za-z0-9_.()\[\]/-]+\.(?:ts|tsx)\b/g;

'[x](src/routes/foo.ts)'.match(FLAT);
// -> ['src/routes/foo.ts']                    fine -- the trailing ')' backtracks off

'[src/routes/tickets.ts](src/routes/tickets.ts)'.match(FLAT);
// -> ['src/routes/tickets.ts](src/routes/tickets.ts']
//    two correct citations merged into one path that resolves nowhere
```

## RIGHT

```js
// Build the path segment-by-segment. A route group or dynamic segment is only
// recognised as a WHOLE segment followed by '/'.
//
// The trailing slash is what makes this safe: a file path always ends in an
// extension, never in ')' or ']', so the special shapes can never be the last
// thing matched -- and because ']' is only reachable inside a bracket segment
// that must be followed by '/', a '](' can never be crossed.
const SEGMENT =
  '(?:' +
  '\\([A-Za-z0-9_-]+\\)' +                          // (dashboard)  route group
  '|\\[{1,2}(?:\\.\\.\\.)?[A-Za-z0-9_-]+\\]{1,2}' + // [id] [...path] [[...path]]
  '|[A-Za-z0-9_.-]+' +                              // ordinary segment
  ')';

const ROOTS = '(?:src|dashboard/src|admin/src)';

const CITATION = new RegExp(
  `(?<![\\w/])${ROOTS}/(?:${SEGMENT}/)*[A-Za-z0-9_.-]+\\.(?:ts|tsx)\\b`,
  'g',
);

'dashboard/src/app/(dashboard)/tickets/[ticketId]/page.tsx'.match(CITATION);
// -> ['dashboard/src/app/(dashboard)/tickets/[ticketId]/page.tsx']

'dashboard/src/app/api/v1/rmm/[...path]/route.ts'.match(CITATION);
// -> ['dashboard/src/app/api/v1/rmm/[...path]/route.ts']

'[src/routes/tickets.ts](src/routes/tickets.ts)'.match(CITATION);
// -> ['src/routes/tickets.ts', 'src/routes/tickets.ts']     two, as intended
```

## NOTES

**Verify through the tool, not by reading the pattern.** A standalone regex
harness is easy to get wrong -- escaping through a shell or an `eval` will
cheerfully build a pattern that matches nothing and report every case as failing,
which looks like a broken regex and is actually a broken test. Feed the real tool
a fixture instead: a page containing `[x](path)`, `[path](path)`, `(see path)`, a
route group, a dynamic segment, a catch-all and a line range, with **every path
pointing at a file that exists**. Correct behaviour is zero findings. A pattern
that is eating punctuation reports paths like `src/foo.ts](src/foo.ts`, which
names the bug in its own output. Then add one deliberately dead App Router path
and confirm it IS caught.

**Diff the old and new patterns over the whole corpus** rather than trusting
spot-checks. Two sets -- matched-before-only and matched-after-only -- tell you
in one pass what you gained and what you broke. That is how the `](` merge above
was found; hand-written examples had suggested the flat class was fine.

**A floor of zero is a claim about what the tool can see.** Worth hunting this
class of bug specifically when ratcheting any counting gate to zero, and when a
gate has been quietly green over a codebase that has since grown a directory
shape the gate predates. Ask what the matcher structurally cannot express before
trusting the number.

**Sibling blind spot, same family:** a checker that bounds-checks `path.ts:10-40`
ranges but not bare `path.ts:42` single-line references. Unmatched input scores
as passing input there too.

Related: [App-router catch-all only handles the verbs it exports](catch-all-verb-exports.md).
