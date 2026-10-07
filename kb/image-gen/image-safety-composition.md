---
tech: image-gen
tags: [ai-image-safety, prompt-composition, false-positive, content-filter]
severity: high
---
# Innocent scene descriptions can trigger image safety filters

## PROBLEM
A card whose mechanic involves returning a creature from the graveyard stages a resurrection scene: "an older man standing perfectly still, one arm reaching forward and down" over "a fallen runner… resolving back into solid form". The safety filter rejects this as `PROHIBITED_CONTENT` without re-retry after one attempt. The composition reads as a standing figure looming over a prone figure—exactly what the filter screens for—even though the intent is resurrection. Reanimation, rescue, and revival cards are the ones most likely to describe a prone figure with a standing figure over them, which is precisely the risky shape.

## WRONG
```typescript
// Direct composition that reads ambiguously to a safety filter
const artPrompt = `
  An older man standing perfectly still,
  one arm reaching forward and down.
  A fallen runner resolving back into solid form,
  amid settling dust.
`;

// Result: PROHIBITED_CONTENT (standing figure over prone figure)
```

## RIGHT
```typescript
// Re-stage with the revived figure ACTIVE, not down
const artPrompt = `
  An older man surging forward mid-stride,
  already up on their feet, moving out of a shimmer of afterimages.
  One hand extended in an open gesture, level.
  Energy resolving around them.
`;

// Avoid: "fallen", "body", "lying", "down" (positions)
// Avoid: "looming over", "standing over", "above" (relative positions with prone figure)
// Use: "mid-stride", "surging forward", "up and moving" (active poses)
```

## NOTES
The filter reads composition and relative posture, not the card's mechanic. A body with a figure standing over it is a risky shape regardless of game context. If content is rejected, try: repositioning the revived figure as active/moving, changing downward reaches to level or upward gestures, and replacing stationary poses with motion. Verify by looking at the rendered picture, not at the success status — a successful generate can still print unrelated art if the token link or shared proxy is wrong.

Multiple revision attempts under high load can also leave a card in a `pending` state with no error and no retry count, so check both the job status AND the card's rendered state in the deck proof.
