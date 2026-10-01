---
tech: css
tags: [cascade, dead-code, selector-collision, computed-style]
severity: high
---
# The same selector in two stylesheets makes a dead feature's rule load-bearing

## PROBLEM
Two features named an element `.dk-pl-body`. The earlier-loaded sheet's rule (a pop-out: grid, `padding: 14px`, `overflow-y: auto`) and the later one's (a score card: flex, gap) both matched the score card, so the card wore every declaration the later rule did not override. When the pop-out became dead code, deleting its rule would have silently changed the live card. A warning about the shared class PREFIX missed it: the collision was the exact selector. A cascade checker that compares contested pairs reported no change either way, because a pair that stops being contested just drops out.

## WRONG
```css
/* slot-drawer.css: feature is dead, so delete its rules by grep on the prefix */
.dk-pl-body { display: grid; padding: 14px; overflow-y: auto; }
```

## RIGHT
```css
/* ladder.css: state what the survivor was inheriting, then delete the dead rule */
.dk-pl-body {
	display: flex;
	gap: 18px;
	padding: 14px;      /* was leaking in from the deleted rule */
	overflow-y: auto;   /* same */
}
```

## NOTES
Before deleting a rule, grep the SELECTOR across every sheet in the cascade. If it exists elsewhere, list the dying rule's declarations the survivor does not override, then carry them over or drop them on purpose. Prove it by comparing computed style before and after in a real engine.
