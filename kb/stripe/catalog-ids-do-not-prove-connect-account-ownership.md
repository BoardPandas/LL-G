---
tech: stripe
tags: [stripe-connect, prices, products, idempotency, multi-tenant-billing]
severity: medium
---
# Catalog Stripe IDs do not prove Connect account ownership

## PROBLEM
A database catalog can contain non-null Stripe product and price IDs while a partner has since reconnected a different Stripe Standard account. The UI sees a configured price and enables Subscribe, but the connected-account subscription call fails with `resource_missing`. Retrying can also create multiple orphan customers when customer identity is persisted only after subscription creation succeeds.

The IDs look valid and type-check, and the partner can be fully charges-enabled, so neither a non-null check nor Connect-readiness check detects the stale ownership.

## WRONG
```ts
const priceId = plan.stripeMonthlyPriceId;
if (!priceId) throw new Error("Plan has no price");

const customer = await stripe.customers.create({ metadata: { orgId, partnerId } });
await stripe.subscriptions.create({ customer: customer.id, items: [{ price: priceId }] });
```

## RIGHT
```ts
// Use a Stripe client scoped to the partner's CURRENT connected account.
// Retrieve stored artifacts there; resource_missing means stale ownership.
const productId = await ensureProductOnCurrentConnectAccount(stripe, plan);
const priceId = await ensurePriceOnCurrentConnectAccount(stripe, productId, plan);

// Recover a metadata-matching customer first, then create idempotently only
// when none exists. Give subscription creation its own deterministic key.
const customerId = await ensureOrgCustomerOnConnect({ stripe, orgId, partnerId });
await stripe.subscriptions.create(
  { customer: customerId, items: [{ price: priceId }] },
  { idempotencyKey: subscriptionAttemptKey(orgId, plan.id) },
);
```

## NOTES
- Product and price ownership is account-scoped; validating the ID on the platform account does not validate it on a connected account.
- Treat only `resource_missing` as permission to recreate. Authentication, permission, rate-limit, and network failures must propagate so transient failures never mint duplicate artifacts.
- Map connected-account errors separately from platform billing errors and never return raw Stripe messages containing price, customer, account, or key fragments.
- Block an existing non-terminal subscription before provisioning or customer creation, and pair Stripe idempotency with a database unique constraint so concurrent requests converge.
