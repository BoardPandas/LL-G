---
tech: supportforge
tags: [rmm, go, jobs, leases, streaming, terminal, redis, sse]
severity: high
---
# Leased job batches can starve interactive device reads

## PROBLEM

An agent leases a batch and executes its entries sequentially. A terminal can
remain open for minutes. File, service, process or registry reads leased in the
same batch wait behind it, even though the parent job already says running.
Their leases can expire before the provider starts. This looks like a slow
filesystem enumeration, but the filesystem code has never run. A healthy
heartbeat and command socket do not prove the read executor started work.

## WRONG

```go
for _, execution := range leasedBatch {
    executeAndWait(execution) // An interactive terminal can occupy this loop.
}
```

Treating the aggregate job state as provider progress, shortening the browser's
poll interval, or adding more wake notifications does not remove this queue.

## RIGHT

Use a separately bounded path for short read-only requests. Keep destructive
actions and durable transfers in their governed job flows. Wake the agent with
an opaque request ID; fetch typed, short-lived authority over mTLS. Bind the
request to tenant, device, actor, action and expiry, and recheck permissions,
elevation and policy before each result delivery. Never authorize OS work from
the wake notification alone.

```text
browser read -> audited, expiring read grant -> opaque agent wake
agent mTLS authority fetch -> bounded read worker -> acknowledged SSE frames
```

Bound duration, concurrent workers, batch bytes and result count. Acknowledge
each directory batch and reject sequence gaps so a lost frame cannot look like
a complete directory. Cancel authority when the browser disconnects. Retain a
worker slot until a blocked OS call actually returns, even if its context has
expired. Enumerate one directory at a time; query Windows logical-drive bits
without opening every possible drive.

## NOTES

Observed in SupportForge issue #158: BH-POS5 reported that a file read lease
expired before the agent started. The previous file provider inspected only
drive roots or immediate directory children, never the whole filesystem.
Service/process/registry snapshots can share the independent read transport.
Preserve explicit truncation warnings. Disable HTTP compression for SSE or use
Cache-Control: no-transform so compression buffering cannot reintroduce delay.

This is a runtime scheduling and streaming lesson, not an agent-configuration
defect. Regression coverage belongs in transport, authorization and provider
tests; no configuration evaluation case is needed.
