---
tech: cloudflare
tags: [ai-gateway, health-check, probe, anthropic, billing, 402]
severity: high
---
# A free AI health probe (GET v1/models) stays green through a total billing outage; probe with a 1-token billed call

## PROBLEM
An AI health probe that calls a free endpoint such as GET `v1/models` cannot detect billing or credit failures, so health stays green while every real inference call fails.
Free endpoints validate the credential but are not billed. Behind Cloudflare AI Gateway they are passed through unbilled even when Unified Billing has run out of credits, so the probe returned 200 throughout an outage in which every `messages` call got 402. The same blind spot exists for an exhausted provider balance, a spend cap or a billing-tier rate limit.

## WRONG
```ts
// "validates credentials without billing tokens"
await client.models.list({ limit: 1 });
probe = { ok: true };
```

## RIGHT
```ts
// The cheapest billed call proves the payer is healthy
await client.messages.create({
  model: platformModel,          // the model the app actually uses
  max_tokens: 1,
  messages: [{ role: 'user', content: '.' }],
  output_config: { effort: 'low' },
});
probe = { ok: true };            // any thrown 401/402/403/429/5xx -> ok:false with the message
// Cache the verdict (e.g. 15 min) so health endpoints stay cheap
```

## NOTES
- Leave `thinking` at the model default: `{type: "disabled"}` is a 400 on some current models, and adaptive thinking simply stops at the 1-token cap (stop_reason `max_tokens`, still a 200).
- Keep the probe out of customer usage metering.
- Cost is negligible: a few input tokens plus one output token per cache window.
