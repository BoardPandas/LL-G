---
tech: magic-tcg
tags: [commander, preview-cards, legality, scryfall, deckbuilding]
severity: high
---
# Future-set cards are not format-illegal

## PROBLEM
Scryfall legality is a current-state field. Before an officially previewed paper
card releases, `legalities.commander` can be `not_legal` even when the card is
expected to become Commander-legal on release. Treating that value as a timeless
verdict silently removes valid future cards from search, recommendations, imports,
and deck reviews. Missing EDHREC, Commander Spellbook, Forge, or simulator data can
compound the false negative, but those are coverage gaps rather than legality facts.

## WRONG
```typescript
const commanderEligible = card.legalities.commander === "legal";

if (!commanderEligible || !forgeSupports(card.name)) {
	removeFromCandidatePool(card);
}
```

## RIGHT
```typescript
const commanderEligible =
	card.legalities.commander === "legal" ||
	(card.legalities.commander === "not_legal" &&
		isOfficialFuturePaperPreview(card) &&
		isExpectedToBecomeCommanderLegal(card));

if (commanderEligible) {
	runLiveBanGameChangerColorAndBracketChecks(card);
}
```

Keep exact current-legality queries exact when callers ask for them, but give
deckbuilding a separate future-inclusive eligibility predicate. Exclude digital-only,
Acorn, silver- or gold-bordered cards, non-deck objects, and anything actually banned.

## NOTES
Label future eligibility provisional. A later live ban or Game Changer result wins.
Third-party absence should be surfaced as reduced evidence or simulation coverage, not
used to turn a qualifying preview into an illegal card.
