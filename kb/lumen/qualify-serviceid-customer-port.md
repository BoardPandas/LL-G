---
tech: lumen
tags: [naas, internet-on-demand, qualify, price, serviceId, masterSiteId, 422, not-a-naas-enabled-location, customer-port]
severity: high
---
# Lumen qualify (/Product/v1/price) requires serviceId for customer-port circuits

## PROBLEM
As of mid-2026 Lumen tightened the Internet On-Demand qualify endpoint
(`GET /Product/v1/price`, productCode 718). A **customer-port** circuit qualified
by bare `masterSiteId` now returns `422 {"reason":"Not a NaaS Enabled Location",
"code":"INVALIDVALUE","propertyPath":"masterSiteId"}`. The location IS still
NaaS-enabled — the endpoint just can no longer resolve a customer-port location
without the circuit identifier.

> **If you are already sending `serviceId` and still get this 422, stop here.**
> The same error is also returned provider-wide while Lumen is faulting, for
> locations that are perfectly fine — see
> [qualify-not-naas-transient.md](qualify-not-naas-transient.md). Do not go
> hunting for a parameter fix, and do not treat it as terminal on first sight.
> This entry covers only the case where the request is genuinely missing
> `serviceId`. This breaks the pricing-refresh sweep AND the IoD
bandwidth-change flow (qualify → quote → order) for customer-port circuits, while
data-center circuits (still resolvable by masterSiteId alone) keep working. Lumen
changed runtime behavior silently — there is no "What's New" entry, so it reads as
"nothing changed on our side and it suddenly broke."

This SUPERSEDES the "qualify location-only" guidance in
[price-qualify-partnerid-422.md](price-qualify-partnerid-422.md): qualify is NOT
location-only. The current reference (spec 2.2.2, 2026-02-19) documents the query
params as productCode (req), masterSiteId (req), `partnerId` ("Use if connection
is with data center"), `serviceId` ("Use if the connection is with a customer
port"). partnerId still must NOT go on qualify (it 422s — see that entry); it
belongs on the quote step (`POST /Product/v1/priceRequest`).

## WRONG
```ts
// Over-generalized from a data-center circuit ("qualify by location only").
// Customer-port circuits 422 "Not a NaaS Enabled Location".
await lumenFetch("/Product/v1/price", {
  params: { productCode: "718", masterSiteId },
  customerNumber, schema, credentials,
});
```

## RIGHT
```ts
// Send the circuit's serviceId alongside masterSiteId. serviceId exists on every
// IoD circuit and is a no-op for still-resolvable locations, so send it always.
// Never send partnerId here (it belongs on the quote step and 422s on qualify).
await lumenFetch("/Product/v1/price", {
  params: { productCode: "718", masterSiteId, serviceId },
  customerNumber, schema, credentials,
});
```

## NOTES
- Verified live against production: `masterSiteId + serviceId` returns 200 for the
  exact circuits that 422 on `masterSiteId`-only; the previously-working
  (masterSiteId-only) circuits still return 200 with serviceId added — so sending
  serviceId unconditionally is safe.
- No data-center circuit was available to confirm the `partnerId`-on-qualify path;
  combined with the sibling entry (partnerId 422s on qualify), the safe rule is
  **always send serviceId, never send partnerId** to qualify.
- **Sending `serviceId` does not make this error terminal.** Adding it fixes the
  cause documented here; it does not fix (and cannot detect) the transient
  provider-wide variant. Callers on an ordering path should still retry a bounded
  number of times before failing — see
  [qualify-not-naas-transient.md](qualify-not-naas-transient.md).
- Fixed in Vigilis 2.103.0: `qualifyService` (src/lib/integrations/lumen/bandwidth.ts),
  `QualifyParams.serviceId` (types.ts), callers refresh-pricing.ts and
  worker/bandwidth-submit.ts (submitInternet).
