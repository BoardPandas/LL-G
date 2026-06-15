---
tech: lumen
tags: [naas, bandwidth, price-qualify, data-center-circuit, 422, partnerId, masterSiteId]
severity: high
---
# Price-qualify endpoint rejects partnerId alongside masterSiteId

## PROBLEM
Lumen's NaaS price-qualify endpoint (`GET /Product/v1/price`) is keyed solely on `masterSiteId`. As of ~2026-06-10 it returns HTTP 422 `{"reason":"Not a NaaS Enabled Location","code":"INVALIDVALUE","propertyPath":"masterSiteId"}` if a `partnerId` query param is sent alongside `masterSiteId`, even for a valid data-center circuit whose partnerId is correct. The same call with partnerId succeeded before that date, so this is an undocumented Lumen-side tightening.

The trap: `partnerId` is still REQUIRED on the QUOTE step (`POST /Product/v1/priceRequest`) for data-center circuits. Quoting a DC circuit by `serviceId` instead returns 422 `"No matching rule found for portSpeed=0 and deviceCode=null"`. So qualify and quote need opposite identifier sets, and attaching the quote's identifiers to qualify silently hard-fails the entire bandwidth-change feature at the QUALIFYING step, before any quote or order. Symptom: every scheduled / manual / Auto-Flux bandwidth change on data-center circuits fails. A periodic pricing sync that qualifies by location only keeps working, masking the cause.

## WRONG
```ts
// Worker resolves the circuit's partnerId and attaches it to BOTH calls.
const qualify = await qualifyService({
  masterSiteId,
  partnerId,          // <-- 422 "Not a NaaS Enabled Location"
  serviceId,
  customerNumber,
  credentials,
});
const quote = await requestQuote({ masterSiteId, partnerId, serviceId, bandwidth, credentials });
```

## RIGHT
```ts
// Qualify by location ONLY (masterSiteId + productCode). No partnerId, no serviceId.
const qualify = await qualifyService({ masterSiteId, customerNumber, credentials });

// Quote still needs the identifier: partnerId for DC circuits, serviceId for standard circuits.
const quote = await requestQuote({ masterSiteId, partnerId, bandwidth, credentials });
```

## NOTES
Rule of thumb: qualify = location-only (`masterSiteId`, never `partnerId`/`serviceId`); quote = `partnerId` for data-center circuits, `serviceId` for standard circuits. Verified live against api.lumen.com. In the vigilis repo the fix landed in `src/lib/integrations/lumen/bandwidth.ts` (`qualifyService`) and `worker/bandwidth-processor.ts` (commit ed6152b1).
