---
tech: architecture
tags: [ranking, relevance, fixtures, testing, real-data, scoring]
severity: high
---
# A ranking test over hand-made fixtures passes while real data fails it

## PROBLEM
Ranking and relevance code is usually tested over a handful of hand-written fixtures, each built to exercise one rule. Fixtures encode the author's model of the data, and real data holds combinations the author did not imagine. A scorer can pass every fixture test and still rank badly on the real corpus, and nothing fails: it returns plausible, wrong results.

In one case a "relevant entries for this repo" scorer gave points per matching signal. One repo marker (`.claude`) mapped to two shelf names (`claude-code` and `claude-config`), and real entries filed under one and tagged with the other matched that single signal twice, scoring 40 against 35 for a high-severity entry on the repo's main technology. Thirteen real entries had that shape, so the top five all came from one source and the most relevant shelf got nothing. The fixture test "every signalled shelf is represented" passed, because no fixture matched one signal under two names.

## WRONG
```ts
// Fixtures: one entry per shelf, one tech each. Passes, and the change is called done.
test("covers every signalled shelf", () => {
  const top = rank(signalsFor(["wrangler.jsonc", ".claude"]), FIXTURES);
  expect(new Set(top.map((e) => e.shelf))).toEqual(new Set(["cloudflare", "claude-code"]));
});
```

## RIGHT
- Before calling a ranking change done, run it over a snapshot of the real corpus with real inputs (a real repo's markers), and assert properties (each signalled shelf has an entry, no one source takes every slot) rather than exact orderings.
- When real data breaks it, copy the offending entries' actual metadata verbatim into a regression fixture.
- Fix the shape, not the case: here, count each signal once however many names it maps to, and give every signalled shelf its best entry before filling the rest by score.
```ts
// Signals matched, not names matched: a signal that maps to two names counts once.
const overlap = signals.filter((s) => s.names.some((name) => entry.terms.has(name))).length;
```

## NOTES
- The bad ranking showed on the first real query after the real index was first loaded; the same check before shipping would have been one call.
- Keep a pinned snapshot of the corpus for the regression test, since a live corpus changes under it.
