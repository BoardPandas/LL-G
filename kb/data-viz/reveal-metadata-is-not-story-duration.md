---
tech: data-viz
tags: [timeline, chronology, provenance, spoilers, content-validation]
severity: high
---
# Reveal metadata cannot define story durations

## PROBLEM

A timeline groups events by the book that reveals them, then uses each group's minimum and maximum event dates to draw book-duration bars. Flashbacks and ancient lore make sequential novels appear simultaneous or centuries long. Packing the bars into separate rows fixes collisions but preserves the false claim.

The source book is provenance and a spoiler boundary, not the event date or a main-story interval. A coarse year also cannot prove simultaneity. Separately, importers that resolve name-leak conflicts by moving all affected facts to a later book can pass validation while corrupting canon: the referenced entity's introduction may be the wrong field.

## WRONG

```ts
const dates = events.filter(e => e.revealedIn === book).map(e => e.year);
const duration = [Math.min(...dates), Math.max(...dates)];
// Draw this as the book's story duration, including its flashbacks.
```

## RIGHT

```ts
// Plot events by their independently sourced occurrence time.
plotEvents(events, e => e.occurredAt);
// A separate source key has no position or length on the time axis.
renderSourceKey(visibleSources.sort(byPublicationOrder));
// If book-duration bars are needed, author and cite main-story bounds.
// Do not derive them from reveal metadata.
```

## NOTES

- Preserve historical dates and reveal gates; never reorder canon events solely to make books look sequential.
- Keep calendar systems separate and expose date precision. Shared years are not necessarily shared instants.
- Validate both visibility directions for corrected rows. Resolve conflicting introductions against chapter references rather than trusting an importer's automatic later-book adjustment.
- Test semantic meaning as well as pixel overlap. A perfectly packed chart can still be wrong.
- Proven in Fandom's DCC and Stormlight timelines. The repair replaced duration ribbons with a source key and restored five DCC events to their actual revealing books.
