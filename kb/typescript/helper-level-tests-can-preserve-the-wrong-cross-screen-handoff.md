---
tech: typescript
tags: [typescript, integration-testing, state-handoff, silent-fallback, ui]
severity: high
---
# Helper-level tests can preserve the wrong cross-screen handoff

## PROBLEM
A multi-screen workflow can silently discard a valid choice even when every helper-level test passes. One test can lock in that a producer does not emit a local query for a seed kind, while another locks in that the consumer falls back to an unrestricted query. Those assertions agree with their individual helpers, but together they erase the user's saved intent and return a plausible, valid-looking global list. There is no crash or malformed response to expose the defect.

## WRONG
```typescript
const RESOLVED_SEED_KINDS = ["card", "archetype", "mechanic", "sentence"];

expect(localSeedQuery({ kind: "playstyle", value: "Make absurd amounts of mana" })).toBeNull();
expect(setupGalleryQuery(draft, null)).toEqual({
  colors: "WUBRG",
  exact: false,
});
```

## RIGHT
```typescript
expect(localSeedQuery(playstyleSeed)).toBeUndefined();

const resolved = await readSeedOnce(playstyleSeed);
const scope = setupGalleryScope(draft, resolved.candidateQuery);

expect(scope.query).toEqual({ baseTheme: "ramp" });
expect(createGalleryState(scope.query).sort).toBe("recommended");
expect(renderScopeReceipt(scope)).toContain("Ramp");
```

## NOTES
Pin user intent at the producer-to-consumer boundary. Model loading, resolved-with-no-basis, and failed states separately so a failure cannot masquerade as an intentional general query. Assert both the outgoing request and the visible receipt explaining the applied scope; comments and isolated helper expectations are not workflow coverage.

