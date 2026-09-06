---
tech: supportforge
tags: [rmm, capabilities, heartbeat, schema-version, testing]
severity: high
---
# Capability name coverage misses schema-version filtering

## PROBLEM

The agent advertises a new capability with payload schema 2. The name is in the
server allowlist, but heartbeat ingestion maps every accepted name to schema 1.
replaceCapabilitySnapshot filters by the exact name/schema pair, so it silently
drops the new descriptor. The website then incorrectly asks the updated endpoint
to upgrade. Tests asserting only that the name is present, and route tests that
mock eligibility, all pass. A compatibility test copying the same v1 mapping
repeats the mistake instead of detecting it.

## WRONG

```ts
const supported = names.map(name => ({ name, schemaVersion: 1, providerVersion }));
expect(names).toContain('rmm.shell.execute.v2');
```

## RIGHT

```ts
const schemas = { 'legacy.console-launch.v0': 1, 'rmm.shell.execute.v2': 2 };
const supported = Object.entries(schemas).map(([name, schemaVersion]) => ({
  name, schemaVersion, providerVersion,
}));
```

## NOTES

Export one explicit versioned descriptor list and use it for heartbeat ingestion
and compatibility tests. Keep exact-pair filtering: accepting any version by name
would hide the bug by weakening protocol checks. Payload schema is independent
of the capability name suffix; legacy v0 still uses payload schema 1.
Regression coverage must pass the agent's advertised descriptor through snapshot
storage and the actual job eligibility check, asserting non-grandfathered success.
After deploying the server fix, an existing upgraded agent repairs its stored
manifest on the next heartbeat. No endpoint binary change is needed.
