---
tech: supportforge
tags: [device-identity, ninjaone, windows, hardware-uuid, recovery, rollout]
severity: high
---
# Hardware serial fallback can change identity comparisons without changing the device

## PROBLEM

SupportForge's Windows serial collector can fall back from BIOS/product serial to hardware UUID when earlier collection methods fail. Both values occupy the same `system_info.serialNumber` field. A refreshed heartbeat can therefore change this field while NinjaOne continues to report the BIOS serial.

A recovery preflight may correctly refuse a changed binding even though both identifiers belong to the same physical endpoint. Skipping the hardware guard or accepting a hostname-only match turns a diagnostic inconvenience into a wrong-device mutation risk.

During a September 27, 2026 rollout check, the first baseline matched NinjaOne's BIOS serial. A later heartbeat reported a UUID. The guard blocked service control before any restart request. A subsequent read-only command returned both BIOS serial and hardware UUID from the same explicitly scoped endpoint; each matched its respective inventory source.

## WRONG

```ts
// A mismatch is not proof that the machine changed.
// Removing the guard is not a safe repair.
if (ninja.systemName === native.hostname) {
  await restartService(ninja.id);
}
```

## RIGHT

```ts
const local = await readHardwareFromExplicitAgent(native.agentId);
// The command must assert the local hostname, canonical UUID and client first.
assert(local.deviceId === native.id);
assert(local.clientId === native.clientId);
assert(ninja.organizationId === expectedNinjaOrg);
assert(normalize(ninja.systemName) === normalize(native.hostname));
assert(validNonPlaceholderSerial(ninja.serial));
assert(normalize(local.biosSerial) === normalize(ninja.serial));

const reportedHardwareMatches =
  normalize(native.reportedSerial) === normalize(local.biosSerial) ||
  normalize(native.reportedSerial) === normalize(local.hardwareUuid);
assert(reportedHardwareMatches);

// Re-read immediately before mutation. Preserve fresh coordinator evidence,
// unique scoped binding, online state, token, service and session checks.
assertHardwareEvidenceIsFresh(local.coordinatorRecordedAt);
await recheckScopedBindingAndRecoveryEligibility();
await restartService(ninja.id);
```

## NOTES

- The comparison permits a UUID only after live evidence binds that UUID and the independently reported BIOS serial to the same approved endpoint. Never allow arbitrary serial-or-UUID fallback based only on string shape.
- Hardware identifiers are inventory correlation evidence, not authentication secrets or a substitute for tenant scope and individual device credentials.
- Preserve the first refused attempt and the additional evidence in the audit. Do not rewrite history as if the original comparison passed.
- NinjaOne reporting `Default string` still fails the hardware check. This lesson does not authorize matching that endpoint by hostname alone.
- Heartbeat gaps and identifier changes are separate observations. Do not claim the collection fallback caused an outage without evidence.
- Observed implementation: `desktop_agent_v2/internal/sysinfo/collector_windows.go` contains BIOS/product serial collection followed by hardware UUID fallback.

