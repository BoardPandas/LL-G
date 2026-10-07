---
tech: typescript
tags: [text-processing, string-truncation, edge-case, data-consistency]
severity: high
---
# Sentence-safe text clipping needs abbreviation protection

## PROBLEM
Fitting researched prose into a character budget requires clipping at sentence boundaries. A naive sentence splitter treats common abbreviations (a.k.a., e.g., etc.) as terminators, silently dropping the rest of a slot. Clipping "Jane Doe a.k.a. Jane Smith, tall with red hair" after "a.k.a." leaves "Jane Doe a.k.a." — which contradicts downstream references to the hair color. This creates manifest inconsistency (silhouette references detail that the clipped field omits) and renders the output malformed.

## WRONG
```typescript
function clipAtSentence(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  
  // Naive split on ". " followed by capital letter
  const sentences = text.split(/\.\s+(?=[A-Z])/);
  let result = '';
  
  for (const sentence of sentences) {
    if ((result + sentence + '.').length > maxLength) {
      break;
    }
    result += (result ? ' ' : '') + sentence + '.';
  }
  
  return result.slice(0, maxLength);
}

// "Jane Doe a.k.a. Jane Smith, tall with red hair."
// Splits on "a.k.a." and returns "Jane Doe a.k.a."
```

## RIGHT
```typescript
const ABBREVIATIONS = new Set(['a.k.a', 'e.g', 'i.e', 'etc', 'vs', 'Mrs', 'Dr', 'Mr', 'Ms']);

function clipAtSentence(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  
  // Split on ". " only when NOT preceded by abbreviation
  let result = '';
  let lastEnd = 0;
  
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '.' && text[i + 1] === ' ' && i + 2 < text.length && /[A-Z]/.test(text[i + 2])) {
      const beforeDot = text.substring(Math.max(0, i - 10), i).trim().split(/\s+/).pop() || '';
      if (ABBREVIATIONS.has(beforeDot)) continue;
      
      const sentence = text.substring(lastEnd, i + 1);
      if ((result + sentence).length > maxLength) break;
      result += sentence + ' ';
      lastEnd = i + 2;
    }
  }
  
  if (lastEnd < text.length && result.length < maxLength) {
    result += text.substring(lastEnd).slice(0, maxLength - result.length);
  }
  
  return result.trim().slice(0, maxLength);
}

// "Jane Doe a.k.a. Jane Smith, tall with red hair."
// Does NOT split on "a.k.a." because it's protected
// Returns full text or truncates at the next real sentence end
```

## NOTES
After clipping, re-read slots against the full silhouette note for orphaned references—a property that was mentioned in the full text but appears truncated in the clips. The cap itself is protective (concatenation keeps slots compact), not arbitrary. Verify all abbreviated words relevant to your domain are in the protected set.
