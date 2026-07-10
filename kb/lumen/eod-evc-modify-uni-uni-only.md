---
tech: lumen
tags: [ethernet-on-demand, evc, bandwidth-modify, dynamic-connection, cloud-connect, data-center, dlr, equinix]
severity: high
---
# EoD EVC bandwidth modify (PATCH /evcs) works only on UNI-to-UNI connections

## PROBLEM
Lumen Ethernet On-Demand `PATCH /Network/v5/DynamicConnection/evcs/{evcId}` accepts a bandwidth change only for UNI-to-UNI EVCs. Every cloud-connect EVC, meaning any EVC whose endpoint carries a `cloudProfile` (`aws-hosted-connection`, `azure`, `azure-gov`, `google-interconnect`, `oracle-virtual-circuit`, `equinix-data-center`, `dlr-data-center`), is rejected with:

```
400 {"exception":{"httpStatusCode":"400","code":"400004","message":"Invalid data","detail":"Bandwidth modify is not allowed for <cloudProvider>"}}
```

This is easy to miss because the restriction is a single sentence in the EoD OpenAPI v5.0.0 spec ("Only available for UNI-UNI connections") and the rejection arrives asynchronously after the change is accepted app-side, so the operator sees an unexplained failure minutes later. Confirmed live in production for `dlr-data-center` (Vigilis issue #458, 2026-07-09). Delete + recreate at the new bandwidth is the only path for cloud-connect EVCs.

## WRONG
```typescript
// Submit any ethernet bandwidth change and let Lumen decide.
// Cloud-connect EVCs fail asynchronously with a generic-looking 400.
await lumenPatch(`/Network/v5/DynamicConnection/evcs/${evcId}`, {
  bandwidth: targetMbps,
  userEmail,
});
```

## RIGHT
```typescript
// Gate app-side on the EVC's cloudProfile provider before submitting.
// Only UNI-to-UNI EVCs (no cloudProfile on either endpoint) are modifiable.
const family = normalizeProviderFamily(evc.cloudProvider); // "uni" when no cloud profile
if (family !== "uni" && family !== "other") {
  throw new Error(
    "Cloud-connect EVCs cannot be modified in place; delete and recreate at the new bandwidth",
  );
}
await lumenPatch(`/Network/v5/DynamicConnection/evcs/${evcId}`, {
  bandwidth: targetMbps,
  userEmail,
});
```

## NOTES
- The error detail interpolates the provider value, so the same failure appears once per provider family rather than as one recognizable message.
- HAEVCs (`/haEvcs`, how Azure ExpressRoute is delivered on the ethernet side) mirror the EVC surface; treat them the same.
- Spec source: developer.lumen.com Ethernet On-Demand API v5.0.0 (OAS 3.0), Modify EVC operation.
