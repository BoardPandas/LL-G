---
tech: architecture
tags: [spoilers, visibility-filter, leak, meta-text, sources, labels]
severity: high
---
# A name-based spoiler filter cannot see meta text: titles, tab labels, group labels, blurbs

## PROBLEM
Hidden rows were filtered, and free text was dropped when it named a hidden entity. Text that names no entity
still leaked later reveals to a reader with nothing (or little) ticked:
- source/page titles such as "Battle of Hathsin", an event revealed in book 3;
- a view tab labelled "Shards", a term first revealed in book 3;
- network legend groups ("Secret identities", "Shards & powers") listed whether or not any link was visible;
- a hub blurb mentioning "the worldhopper";
- a persona entity "Reen's voice" that showed in book 1 and implied the whisper was real.
Grep-for-hidden-names tests pass on all of these.

## WRONG
```ts
sources: full.sources.filter((s) => !hiddenNames.test(s.title)), // title names no entity: shown
LINK_GROUPS.map(renderCheckbox)                                  // labels for links the reader can't see
```

## RIGHT
```ts
// Give each source the works that reveal the rows citing it; list it only once one is read.
sources: full.sources.filter((s) => s.books.some((b) => read.has(b)) && !hiddenNames.test(s.title)),
// List only groups that have something visible, and keep hub-level copy and tab labels neutral.
LINK_GROUPS.filter((g) => snapshot.relationships.some((r) => g.kinds.includes(r.kind)))
```

## NOTES
- Validation should refuse a source nothing cites; otherwise its empty reveal set means "always listed".
- Introduce a disguise persona in the book that reveals it when the earlier books present it as memory or madness.
- A second agent auditing only the assembled content found 11 such leaks the drafting agents missed.
- Related: `spoiler-filter-must-cover-sources-and-compare-ids-by-field.md`.
