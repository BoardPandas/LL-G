---
tech: architecture
tags: [source-of-truth-drift, derived-signal, refactor-fallout, silent-failure, feature-flag-gate, llm-prompt, cost-guardrail]
severity: high
---
# A derived signal goes silently constant when its source column stops varying

## PROBLEM

A consumer derives a quality/health signal by testing a column for a specific value (`extractor === 'claude_sonnet'`, `status === 'retried'`, `tier === 'fallback'`). Later, an unrelated refactor upstream makes that column a constant -- a two-model pipeline collapses to one model, a status enum loses a branch, a tier is retired -- and every writer now stamps the same value on every row.

Nothing errors. The column still exists, still has the right type, still passes `NOT NULL`. Typecheck is green, tests are green, and the job logs "completed successfully" on every run. But the derived count is now identically equal to the row count, and it silently means the opposite of what it says.

The damage compounds when that signal feeds two things at once:

1. **A gate.** `if (failureCount > 0)` becomes always-true, so the expensive work the gate existed to prevent now runs on every item. A cost guardrail silently disappears; spend goes up with no error anywhere.
2. **An LLM prompt.** The prompt asserts `"N parses failed validation"` for items with zero failures. A well-behaved model reads the false evidence, finds no real defect, and correctly declines to act -- so the feature produces **zero output indefinitely** while every log line reports success. The model's correctness is what hides the bug.

Real case (Vigilis, 2026-07): a monthly rule-improvement pass read `extractorProvider === 'claude_sonnet'` as "the cheap first-pass model failed validation". The Haiku-first tier had been dropped months earlier, so the extractor hardcoded `claude_sonnet` on every write. Result: an expensive Opus review ran on every carrier including ones parsing perfectly, was handed "Haiku failed validation: 7" for a carrier with 7 clean parses, and produced 0 proposals across 2 monthly runs. The page sat empty for months and looked like a cron that never fired -- it had fired every time.

**The tell: a derived count that exactly equals the total row count.** Check it in SQL before believing any "nothing to report" result.

## WRONG

```ts
// producer -- refactored months ago; the tier this value distinguished is gone
return { result, extractor: "claude_sonnet", ... };  // every path, unconditionally

// consumer -- still reading the value as if it discriminated
if (row.extractorProvider === "claude_sonnet") sonnetFallbackCount++;

function hasFailureSignal(s: Signals): boolean {
  return s.lowConfidenceCount > 0 || s.sonnetFallbackCount > 0 || /* ... */;
}                                    // ^ now always true -> gate is dead

prompt.push(`- Fallback parses (first model failed validation): ${s.sonnetFallbackCount}`);
//            ^ asserted as fact to an LLM; false for every clean item
```

## RIGHT

```ts
// Read the signal that actually still varies. Here the real "first pass failed"
// marker was already persisted, just unused.
if (row.extractionTokenUsage?.retried === true) retriedCount++;
```

Anchor the field to the reason it can be trusted, so the next refactor trips over the comment:

```ts
/**
 * Extractions whose first pass failed validation and had to be retried.
 * Read from `extraction_token_usage.retried`, NOT from `extractorProvider`:
 * the Haiku-first tier was dropped in #398, so `extractorProvider` is now the
 * constant `claude_sonnet` on every row and carries no quality signal.
 */
retriedCount: number;
```

Pin the gate with a test asserting the *negative* case -- the assertion that fails the moment the signal goes constant:

```ts
it("skips a carrier whose invoices all parsed cleanly", () => {
  expect(hasFailureSignal(signals())).toBe(false);  // all-zero signals
});
```

Verify against real data, not just types:

```sql
-- If a "failure" count equals the row count, the signal is dead.
SELECT extractor_provider, count(*) FROM provider_invoices GROUP BY 1;
--  claude_sonnet | 24   <- single row: the column discriminates nothing
```

## NOTES

- **Why tests didn't catch it:** the gate had only positive-case tests (signal present -> review). Nothing asserted the all-clean case returns `false`, which is the exact assertion that goes red when a signal becomes constant. A gate deserves a negative test more than a positive one.
- **Why monitoring didn't catch it:** the job's own summary log (`reviewed: 7, proposalsCreated: 0`) is indistinguishable from a healthy "nothing to improve" run. If a pipeline can legitimately produce zero output, its success log cannot tell you it is working -- alert on the *ratio* (items gated in vs. total) rather than on completion.
- **Grep for orphaned discriminators when retiring a branch.** Deleting a model tier / status / enum variant is not done when the producer compiles: `grep -rn '"claude_sonnet"'` across consumers. A string compare against a now-constant value is invisible to the compiler because the type never narrowed.
- **LLM prompts are an especially bad place for a stale signal.** Ordinary code fails loudly on bad input; a model absorbs a false premise and returns a confident, plausible, wrong-for-the-right-reason answer. Treat every count interpolated into a prompt as a factual claim you are responsible for, and state uncertain evidence as description rather than as a defect count.
- Related: `batch-op-keys-on-specific-status-field.md` (gating on a sibling flag instead of the specific status field), `transient-cache-without-drift.md` (a second source of truth drifting from the first).
