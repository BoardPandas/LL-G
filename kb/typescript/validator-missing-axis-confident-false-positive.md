---
tech: typescript
tags: [validator, detector, static-analysis, false-positive, silent-wrong-output, invariants, rules-engine, lint]
severity: high
---
# A validator that checks N-1 of N conditions returns confident false positives

## PROBLEM

When a property requires N conditions and your validator models N-1, it does not fail
loudly. It returns a **confident wrong answer** on exactly the inputs where the
unmodeled condition is the binding constraint — no error, no hedge, no low-confidence
signal. Every test you wrote passes, because you wrote tests for the axes you thought of.

Two things make this worse than an ordinary bug:

1. **Authoritative framing suppresses review.** A result labeled "tool-confirmed",
   "deterministic", or "verified" makes downstream code *stop questioning it*. In the
   case below, a one-axis-short tally was allowed to **override** a more careful curated
   check, because the tally was the one that sounded certain.
2. **The unmodeled axis is invisible in the output shape.** The result type has no field
   for the thing you didn't model, so nothing downstream can even ask.

**Worked example.** `comboCheck()` decides whether a Magic: The Gathering loop is an
infinite combo, by tallying net resources per iteration. It modeled two axes — mana
self-sufficiency and positive payoff — and the source even carried a careful comment
("Two SEPARATE axes -- do NOT collapse them into one signed boolean"), so the author had
clearly thought hard about axis separation. It was still one axis short.

The missing axis was **repeatability**. A free sacrifice outlet plus a recursion engine
that returns the creature *"at the beginning of the next end step"* tallies net +0 mana,
+1 scry, nothing drained — arithmetically **identical** to a net-zero token loop that
genuinely is infinite. But a delayed trigger created during the end step does not fire in
that step (the step doesn't "back up"), so the loop runs **once per turn**. A value
engine, not a combo.

Downstream, the deck evaluator called the checker, got `self-contained-infinite`, labeled
it "tool-confirmed", and used it to raise a correctly-graded deck a full power bracket in
user-facing output. A second, quieter detector disagreed — and the quiet one was right.

## WRONG

```ts
// "Infinite" requires THREE conditions. This models two.
export function comboCheck(input: { steps: LoopStep[] }): ComboCheckResult {
  const netMana = input.steps.reduce(
    (n, s) => n + (s.manaProduced ?? 0) - (s.manaCost ?? 0), 0);
  const net = tallyResourceDeltas(input.steps);

  // axis 1: does the loop pay its own mana?
  const manaSelfSufficient = netMana >= 0;
  // axis 2: does it net something positive, and drain nothing?
  const hasNegativeAxis = netMana < 0 || Object.values(net).some((v) => v < 0);
  const hasPayoff = netMana > 0 || Object.values(net).some((v) => v > 0);

  if (manaSelfSufficient && !hasNegativeAxis && hasPayoff) {
    // Confidently WRONG whenever repetition is gated by the CLOCK rather than by
    // resources. Nothing here can tell the two apart -- and the result type has no
    // field for the axis that wasn't modeled, so no caller can compensate.
    return { verdict: "self-contained-infinite", netManaPerIteration: netMana, ... };
  }
  // ...
}
```

## RIGHT

```ts
export interface LoopStep {
  label: string;
  manaCost?: number;
  manaProduced?: number;
  deltas?: Record<string, number>;
  /** axis 3: a once-per-turn boundary this step waits on ("at the beginning of the
   *  next end step"). Repetition bounded by the CLOCK, not by resources. */
  gatedBy?: string;
}

export function comboCheck(
  input: { steps: LoopStep[]; timingGates?: string[] },
): ComboCheckResult {
  // ...axes 1 and 2 exactly as before, producing `verdict` / `reason`...

  const timingGates = [...new Set([
    ...(input.timingGates ?? []),
    ...input.steps.flatMap((s) => (s.gatedBy ? [s.gatedBy] : [])),
  ])];

  // The unmodeled axis OVERRIDES a favorable ledger, and only ever DOWNGRADES.
  // No per-iteration tally, however good, makes a clock-gated loop infinite.
  if (verdict === "self-contained-infinite" && timingGates.length > 0) {
    verdict = "needs-external-enabler";
    reason =
      `ledger is favorable (${netMana} mana, nothing drained), but each iteration is ` +
      `gated on ${timingGates.join("; ")} -- it repeats at most once per turn`;
  }

  // Surface the axis in the RESULT so callers can see it was considered.
  return { verdict, netManaPerIteration: netMana, timingGates, reason, trace };
}
```

Do not rely on the caller to declare the new axis — the caller usually does not know it
exists, which is the whole reason the bug shipped. Derive it from the source data:

```ts
const ONCE_PER_TURN_GATE =
  /\bat the beginning of (?:the|your|each|their)?\s*(?:next\s+)?(end step|upkeep|main phase)\b/i;

// Primary: read the gate out of the source text the claim is about.
const timingGates = factSheets.flatMap((fs) => {
  const m = ONCE_PER_TURN_GATE.exec(oracleTextOf(fs));
  return m ? [`${fs.name}: "${m[0]}"`] : [];
});

// Backstop, where only free-text labels are available: callers describing a delayed
// trigger nearly always WRITE the phrase, even when unaware the timing is what matters.
const gate = explicitGate || ONCE_PER_TURN_GATE.exec(step.label)?.[0];
```

## NOTES

- **The generalizable rule:** a validator whose contract is *"never assert X until
  proven"* must enumerate the **full** set of conditions for X, and must fail toward
  **not** asserting whenever any condition is unmodeled. Conservative bias is correct
  here — a false "needs more" is cheap, a false "confirmed" is not.
- **Two detectors disagreeing is a signal to investigate, not to believe the scarier
  one.** The name-keyed lookup that found nothing was correct; the deterministic tally
  that "confirmed" an infinite was wrong. Loud does not mean right.
- **Audit the override paths.** The real damage was not the wrong verdict, it was that a
  confident wrong verdict was wired to override a more careful check. If detector A can
  override detector B, A needs the higher bar, not the louder label.
- **Derive, don't ask.** Adding an optional `gatedBy?: string` and documenting it is not a
  fix on its own — every caller that already had the bug will keep omitting it. Auto-derive
  from source data, with a text fallback, and treat the explicit field as an override.
- Same family as [A source-scanning lint must assert its own coverage, or "no findings"
  means nothing](lint-must-assert-its-own-coverage.md) and [A green typecheck + test run
  can prove nothing about an entire directory](tsconfig-exclude-voids-green-gates.md):
  all three are cases where a checker's *silence or confidence* was read as evidence when
  the checker never examined the relevant thing.
