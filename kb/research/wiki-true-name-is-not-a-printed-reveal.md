---
tech: research
tags: [fan-wikis, citations, spoilers, identities, provenance]
severity: high
---
# A wiki's true-name attribution is not an in-book identity reveal

## PROBLEM

A fan wiki describes a disguised character under their canonical identity and cites a novel
for their actions. That citation supports the scene, but does not necessarily establish that
the novel prints the true name or reveals the connection. Importing the article's identity
into a spoiler-aware atlas silently tells readers something their selected book never told
them. Ordinary schema checks pass because every row has a real citation.

This also leaks through entity ids, aliases, source titles and source URLs. Hiding the display
name alone is insufficient. Cross-reading two novels is not itself proof that either novel
establishes the connection.

## WRONG

```yaml
# The wiki calls this visitor Arin and cites book-b for the visit.
- id: arin
  name: Arin
  introBook: [book-a, book-b]
  facts:
    - { book: book-b, text: "Visits the island in disguise." }
- { source: the-traveller, target: arin, kind: same_as, book: book-b }
```

## RIGHT

```yaml
# Names are illustrative. The book calls the visitor only "the Traveller".
- id: the-traveller
  name: The Traveller
  introBook: book-b
  facts:
    - { book: book-b, text: "Visits the island." }
# Add same_as only after verifying a printed identity reveal, tagged to that work.
```

Audit separately whether the work supports the action, the displayed name, the alias and the
identity connection. Prefer primary text or a citation that explicitly describes the reveal;
when that is unavailable, keep separate personas and omit the unverified connection. Use
neutral ids and citations whose metadata does not reveal the hidden name.

## NOTES

- Found in a multi-world fiction atlas: wiki-attributed visitors, letter writers and renamed
  characters incorrectly inherited later identities even though their scene citations were real.
- Every individual-work mask needs positive assertions as well as leak assertions. Adding only
  an entity's first novel to an any-of introduction set makes later novels and collected novellas
  silently empty. Widen introductions only where the same displayed identity is established;
  do not widen all earlier facts or infer a secret identity from a later scene.
- A filter can enforce correctly tagged canon; it cannot prove the research tags are correct.
  Keep an independent provenance audit alongside structural validation and serialized-response tests.
