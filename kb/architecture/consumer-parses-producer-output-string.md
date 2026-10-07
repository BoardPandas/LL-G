---
tech: architecture
tags: [coupling, string-parsing, query-fragment, shared-module, silent-failure, refactor]
severity: high
---
# A consumer that parses another module's output string breaks silently when that output grows a clause

## PROBLEM
Module B reuses module A by calling A's formatter and slicing the result
(`after(facet.toFragment(state), "id<=")`). A's own tests pin A's output, B's tests
often compare against A's output, so when A's output gains a clause for A's own
feature (`id<=wur` becomes `id<=wur -id:c`), every test on A's side stays green and
B quietly derives a malformed value (`"wur -id:c"`) and sends it to its server.

Seen in BoardPandas/tcg 3.718.0.0: the deck builder's pool derived its colour and
type layer values from the Cards browser filter's search fragment. Excluding
colorless from the browser's "Any combo" fragment would have broken the builder.
It was caught only because every consumer of the facet was grepped before the change.

## WRONG
```js
// builder: derive the layer value by slicing the browser's search text
const frag = colorFacet.toFragment({ colors: set, mode: "subset" });
const value = after(frag, "id<="); // "wur -id:c" once the browser adds a clause

// test that cannot catch it: compares against the producer, not a literal
expect(`id<=${layer.value}`).toBe(colorFacet.toFragment(state));
```

## RIGHT
```js
// ask the producer for the shape the consumer MEANS (colorless included = C on)
const frag = colorFacet.toFragment({ colors: new Set([...set, "C"]), mode: "subset" });
const value = after(frag, "id<=");

// pin the derived value literally, so a producer change fails here
expect(layer.value).toBe("wb");
```

## NOTES
- Before changing any formatter's output, grep every caller of it (and of whatever
  registry hands it out, e.g. `facetByKey("color")`), not just its own surface.
- Better still: expose structured data (the letters) from the producer and format in
  each consumer, so neither depends on the other's string grammar.
- A consumer test that asserts equality WITH the producer's output is vacuous for this
  failure; assert a literal.
