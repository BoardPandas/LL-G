---
tech: image-gen
tags: [image-editing, prompt-composition, style, outpainting, request-signatures]
severity: high
---
# A source-preservation wrapper can contradict an included art style

## PROBLEM

An image-edit request can contain the selected style and still instruct the model to preserve
the source's colors, lighting, and textures exactly, or forbid restyling. Outpainting makes this
easy to miss: the extension may follow the requested style while the original art remains largely
unchanged. A successful provider response, a style ID, or a style-text inclusion test does not
detect the contradictory instructions.

TCG exposed this when adding space above official card art appeared to weaken an applied style.
The complete request contained both the style authority text and a no-restyle wrapper. The
contradiction was reproducible in request assembly; visual causation was not proved by an
uncontrolled comparison of earlier generated candidates.

## WRONG

```ts
const system = "Reproduce the source faithfully; change only the modification.";
const imageRole = "Preserve colors and lighting EXACTLY. Do NOT repaint or restyle.";
const modification = `${selectedStyle}\n\n${scene}`;
```

Checking only `modification.includes(selectedStyle)` passes. A semantic signature that omits
fixed system/image-role text also stays unchanged after correcting the wrapper.

## RIGHT

```ts
const restyle = layers.some(layer =>
  layer.id === "stylePrompt" && layer.included && layer.content.trim()
);
const treatment = restyle ? "restyle-v1" : undefined;
const instructions = restyle
  ? "Apply the selected style across the original art and any added canvas; preserve subject identity, pose, and placement unless explicitly changed."
  : legacyPreservationInstructions;
```

Derive treatment from the materialized plan, not style IDs, reference-image counts, or text
searches. Make system and image-role instructions agree. Keep unstyled request wording unchanged.
Carry the active treatment revision through dispatch identity, semantic/review signatures, and
the existing effective-style drift fact if those signatures do not hash the wrapper itself.

## NOTES

- Test complete provider instructions for styled/unstyled requests with and without added canvas,
  including every provider's flattened prompt and worker/preview parity.
- Added canvas must follow the chosen style along with the original region. Phrase gray-area
  instructions conditionally when a tall source may need no padding.
- Preserve subject/layout constraints independently of aesthetic preservation.
- Prompt tests establish request consistency. Inspect an authorized generated sample separately
  before claiming visual style adherence.
