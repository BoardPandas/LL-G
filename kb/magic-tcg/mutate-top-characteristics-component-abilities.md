---
tech: magic-tcg
tags: [magic-the-gathering, mutate, merged-permanent, station, dryad-arbor]
severity: high
---
# Mutate separates top characteristics from component abilities

## PROBLEM
Rules explanations often treat a mutated permanent as though the top card either preserves the lower card's identity or erases its text box. Neither is correct. The topmost component supplies the merged permanent's characteristics, while the permanent keeps every ability of every component. A second, less obvious trap is treating subtype-intrinsic rules as printed abilities: Dryad Arbor has no Oracle ability, so its mana ability exists only while the permanent has the Forest subtype.

This produces silent wrong output for unusual hosts. A mutator on top of a Spacecraft does not keep the Spacecraft name or type, but it does keep Station and threshold abilities from underneath. A mutator on top of Dryad Arbor usually removes land and Forest, so the Forest mana ability disappears even though component abilities are retained.

## WRONG
```text
Mutator on top: keep the lower card's name and type, but lose its abilities.
Dryad Arbor underneath still taps for {G} because mutate keeps all abilities.
```

## RIGHT
```text
Mutator on top: take name, mana cost, color, types, subtypes, and base P/T from
the top component; keep every ability from every component.

Dryad Arbor's {T}: Add {G} is intrinsic to the Forest subtype, not printed Oracle
text. If the mutator on top removes Forest, that intrinsic ability is absent.
```

## NOTES
Ground the result in CR 702.140e and 730.2a-c. For Station hosts, apply the retained station-symbol static ability under CR 721.2a-b without restoring the lower card's name, artifact type, or Spacecraft subtype. For basic land types, check CR 305.6 before labeling an intrinsic mana ability as inherited text.
