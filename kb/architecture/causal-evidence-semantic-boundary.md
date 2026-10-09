---
tech: architecture
tags: [event-bus, causal-attribution, state-based-actions, provenance, lifecycle]
severity: high
---

# Causal event evidence must expire at the semantic boundary, not the next callback

## PROBLEM

Event-driven systems can publish logging, UI, priority, or cleanup callbacks
before the domain outcome is finalized. Clearing pending causal evidence on the
next callback silently loses valid attribution. Retaining one global "last
event" instead silently attributes a later, unrelated outcome. Unit tests that
fire only the cause and final outcome miss the production event order.

## WRONG

```java
void onEvent(GameEvent event) {
    sampleFinalOutcomes();
    pendingEvidence.clear();
    recordCandidate(event);
}
```

This treats every callback as a causal boundary even when the domain resolves
state-based outcomes only after an intermediate event.

## RIGHT

```java
void onEvent(GameEvent event) {
    sampleFinalOutcomes();

    if (event.startsResolutionCheckpoint()) {
        checkpointEvidence = pendingEvidence;
        pendingEvidence = newEvidenceMap();
        return;
    }

    recordCandidateWithinItsScope(event);
}

Attribution resolveLoss(Loss loss) {
    return findBasisCompatibleEvidence(loss, checkpointEvidence)
        .orElse(Attribution.unattributable(loss.basis()));
}
```

Model evidence by victim and causal scope. Carry it across callbacks that occur
inside the same semantic resolution boundary, consume only evidence compatible
with the finalized outcome, and expire it at the next checkpoint. If scope or
basis does not match, report the outcome as unattributable rather than guessing.

## NOTES

Drive the regression probe in the exact production event order, including every
intermediate callback. Include a no-loss checkpoint followed by a later loss to
prove stale evidence expires; testing only a happy-path cause followed directly
by an outcome cannot distinguish correct retention from a global-last-event bug.
