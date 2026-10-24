---
tech: cloudflare
tags: [ai-gateway, unified-billing, byok, anthropic, workload-identity, oauth, 402]
severity: high
---
# AI Gateway Unified Billing silently pays the provider when it does not recognize your credential, then 402s when credits run out

## PROBLEM
With Unified Billing available on an AI Gateway (`byok_only` off), a request whose provider credential Cloudflare does not recognize is served on Cloudflare's own provider key and billed to gateway credits, with no error until the credits run out.
An Anthropic OAuth / workload-identity-federation bearer (`Authorization: Bearer <token>` plus `anthropic-beta: oauth-2025-04-20`, no `x-api-key`) is not recognized as a customer credential. Calls succeed for weeks, so it looks like your own Anthropic org is paying. When the credit balance hits $0, every billable call gets HTTP 402 "Payment Defaulted" / "Insufficient unified billing credits" from the gateway itself (timings.latency 0, never forwarded). Unbilled calls such as GET `v1/models` still pass the bearer through and succeed, which hides the problem. Turning on `byok_only` refuses the same calls with 400 code 2044 "Customer-provided provider credentials are required", and it also refused Google AI Studio requests carrying `x-goog-api-key` that the gateway otherwise forwards and Google bills correctly.

## WRONG
```ts
// Federated (WIF) Claude client routed through the gateway
new Anthropic({
  apiKey: null, authToken: null,
  credentials: wifCredentials(),          // sends Authorization: Bearer
  baseURL: `https://gateway.ai.cloudflare.com/v1/${acct}/${gw}/anthropic`,
  defaultHeaders: { 'cf-aig-authorization': `Bearer ${cfToken}` },
});
// Cloudflare pays Anthropic from gateway credits; 402 once they are gone
```

## RIGHT
```ts
// Send federated Claude straight to Anthropic; keep the gateway for
// providers whose key header Cloudflare forwards (verify per provider)
new Anthropic({
  apiKey: null, authToken: null,
  credentials: wifCredentials(),
  // no baseURL: api.anthropic.com bills your own org
});
// Keep the gateway credit balance at $0 with auto top-up off, so any
// unrecognized request fails loudly instead of costing money
```

## NOTES
- Verify which credential paid: with credits at $0, a 200 with real upstream latency means your key was forwarded; a 402 means the gateway was paying.
- The gateway-level `wholesale` field is not writable through the gateway PUT API; `byok_only` is the documented switch, but test it against every provider first because it may reject provider keys the gateway otherwise forwards.
- Do not send `cf-aig-metadata` headers to the provider directly: they carry tenant metadata and do nothing off-gateway.
- Related: a free health probe cannot see this failure (see the companion entry on billed health probes).
