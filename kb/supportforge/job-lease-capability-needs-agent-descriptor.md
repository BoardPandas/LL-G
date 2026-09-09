---
tech: supportforge
tags: [rmm, capabilities, job-lease, desktop-agent, coverage-tests, silent-failure]
severity: high
---
# A job-lease capability needs an agent descriptor, and the push coverage test cannot see it

## PROBLEM

A capability has to be spelled in three places or the work never runs: the agent
registers a descriptor advertising it, the consumer declares it, and the server
accepts it into the stored manifest. That rule is written down for **device
pushes**, and a test on each side enforces it -- `rmm-027-capability-coverage.test.ts`
scrapes `capability: 'x.vN', schemaVersion` out of `deliverEligibleToDevice` calls,
and `capability_manifest_test.go` requires the agent to advertise each one.

**A durable job command needs the same three places and neither test covers it.**
The capability lives in a `JobCommandDefinition`, not in a delivery option, so the
scrape does not match it; and the Go test reads that same scrape, so both halves are
blind to the same omission.

The two also fail *differently*, which is what makes the job case quiet. A push is
refused inside `deliverEligibleToDevice` before anything leaves the server. A lease
is refused inside `leaseExecutions`, which **fails the execution** with
`CAPABILITY_NOT_ADVERTISED` -- so the operator is told the deployment went out, and
the refusal lands in a row nobody rereads. Nothing surfaces as an error at the time
of the request.

This shipped: RMM-026's OS-neutral patch commands had a complete 354-line Linux
installer, a server route creating the jobs, the capability already in the accepted
manifest list, and a release gate asserting "Linux execution wiring" -- but no agent
descriptor. Every execution was refused at lease. Linux patch *scanning* worked,
which is what made the feature look delivered. The gate passed because it only
checked that the route existed, that the migration had its tables, and that two
command-type constants held the right strings.

A grandfathering rule hides it further: a device advertising *no* capabilities is
allowed through, so the only endpoints refused are the modern ones carrying the
provider.

## WRONG

```ts
// src/rmm/<feature>/commands.ts -- the command declares the capability
export const patchJobCommands = [{
  type: PATCH_INSTALL_COMMAND,          // rmm.job.patch-install.v1
  capability: PATCH_AGENT_CAPABILITY,   // rmm.patch.execute.v1
  schemaVersion: 1,
  // ...
}];
```

```go
// desktop_agent_v2/internal/agent/<feature>_jobs.go -- handler registered...
func (a *Agent) registerPatchDeployments(registry *jobs.Registry) error {
    return registry.Register(patching.InstallCommandType, 1, handler)
}
// ...and register_rmm_handlers.go never advertises rmm.patch.execute.v1.
// The job is created, leased, and failed with CAPABILITY_NOT_ADVERTISED.
// The deployment reported it as queued.
```

## RIGHT

```go
// register_rmm_handlers.go -- the descriptor exists ONLY to put the capability in
// the advertised manifest. Work arrives through the job lease, not this push, so
// the handler is unreachable by design and says so. Register demands a non-nil
// handler, which is the only reason it exists.
if runtime.GOOS == "linux" { // claim it only where the provider is real
    descriptors = append(descriptors, rmmkernel.Descriptor{
        Type: "rmm.patch.execute.v1", SchemaVersion: 1,
        Direction: rmmkernel.ServerToAgent,
        Capability: "rmm.patch.execute.v1", ProviderVersion: providerVersion,
        ValidatePayload: validateObjectPayload,
        Handle: func(context.Context, rmmkernel.HandlerContext, contractsv1.Envelope) (any, error) {
            return nil, fmt.Errorf("patch execution requires an approved durable job lease")
        },
    })
}
```

```ts
// A coverage test derived from the command registry, not a restated list, so a
// command added tomorrow is covered the moment it is registered.
for (const command of jobCommands.list()) {
  expect(descriptorSource.includes(`"${command.capability}"`)).toBe(true);  // agent advertises it
  expect(accepted).toHaveProperty(command.capability);                      // server accepts it
  expect(command.schemaVersion).toBe(accepted[command.capability]);         // exact (name, schema) pair
}
```

## NOTES

- Assert the **(name, schemaVersion) pair**, never the name alone -- the manifest is
  filtered on the exact pair. See
  [capability-name-coverage-misses-schema-version.md](capability-name-coverage-misses-schema-version.md).
- A static read of `register_rmm_handlers.go` cannot say *which build* advertises
  what: the manifest is assembled at runtime behind `runtime.GOOS` and `Supported()`
  guards. Asserting that *some* build advertises it is what catches the real failure;
  per-platform coverage belongs in the Go suite, where the manifest can be built.
- Advertise a capability only on the platforms whose provider is real. Two providers
  claiming one device is the opposite failure, and it is louder but no better.
- When the capability genuinely is not wired yet, refuse at **creation** rather than
  letting the job be created: the operator is still looking at the request, whereas a
  failed execution row is read later, by someone else, if at all.
- The generalisable smell: when two paths share a rule but fail in different places,
  a test written for the louder path will not cover the quieter one -- and the quieter
  one is the one that ships broken.
