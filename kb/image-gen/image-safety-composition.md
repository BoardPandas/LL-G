---
tech: image-gen
tags: [ai-image-safety, prompt-composition, false-positive, content-filter]
severity: high
---
# Innocent scene descriptions can trigger image safety filters

## PROBLEM
A resurrection scene: "standing figure over prone figure" is exactly what the filter screens for, even though intent is reanimation. Reanimation, rescue, revival cards most likely describe a prone figure with standing figure over them — precisely the risky shape.

## WRONG
```typescript
const prompt = `An older man standing perfectly still, one arm reaching down.
  A fallen runner resolving back into solid form.`;
// Result: PROHIBITED_CONTENT
```

## RIGHT
```typescript
const prompt = `An older man surging forward mid-stride, up on their feet,
  moving out of a shimmer. One hand level and open.`;
// Avoid: "fallen", "body", "lying" (positions)
// Use: "mid-stride", "surging", "up and moving" (active poses)
```

## NOTES
Filter reads composition and posture, not mechanic. Reposition revived figure as active, not down. Verify by looking at rendered picture, not success status.
