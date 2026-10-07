---
tech: llm-integration
tags: [llm, pricing, usage, token-accounting, tool-calling, retries, cache]
severity: high
---
# Aggregating token totals before tiered pricing misprices multi-request turns

## PROBLEM
An agent turn can contain several provider requests: the initial model call, one or more tool-loop continuations, and a retry. Tiered token rates apply to each provider response independently, but an aggregator that first sums all input and output tokens then prices the total crosses a tier boundary that no individual request crossed. Two 60K-token requests can therefore be charged at the 120K-token rate. The resulting cost is plausible, no request fails, and dashboards silently under- or over-report usage. Cache-read and cache-write tokens have their own rates and must be preserved on every response rather than folded into an aggregate input count.

## WRONG
```ts
const totalInput = responses.reduce((n, usage) => n + usage.inputTokens, 0);
const totalOutput = responses.reduce((n, usage) => n + usage.outputTokens, 0);
const cost = priceForTier(totalInput, totalOutput);
```

## RIGHT
```ts
type ResponseUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

const cost = responses.reduce(
  (total, usage) =>
    total +
    priceResponse({
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
    }),
  0,
);
```

## NOTES
Store one immutable usage record per provider response, including cache-read and cache-write counts, then derive both the aggregate usage display and the aggregate cost from that response list. Test two sub-threshold requests whose sum crosses a pricing boundary, a retry, and a tool-loop continuation. Do not infer cache values from cumulative totals.
