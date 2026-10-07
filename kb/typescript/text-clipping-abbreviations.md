---
tech: typescript
tags: [text-processing, string-truncation, edge-case, data-consistency]
severity: high
---
# Sentence-safe text clipping needs abbreviation protection

## PROBLEM
Naive sentence splitters treat a.k.a., e.g., etc. as terminators. Clipping "Jane Doe a.k.a. Jane Smith, tall with red hair" after "a.k.a." leaves "Jane Doe a.k.a." — contradicting downstream references to the hair color.

## WRONG
```typescript
const sentences = text.split(/\.\s+(?=[A-Z])/);  // Splits on "a.k.a."
```

## RIGHT
```typescript
const ABBREVIATIONS = new Set(['a.k.a', 'e.g', 'i.e', 'etc', 'vs', 'Mrs', 'Dr']);

// Split only if not preceded by abbreviation
function clipAtSentence(text, maxLength) {
  // Protect known abbreviations, then clip
}
```

## NOTES
After clipping, re-read slots against the full note for orphaned references. Verify all relevant abbreviations are protected.
