---
tech: architecture
tags: [filesystem, concurrency, storage-accounting, quota, reservations, atomic-rename, enoent, deadlines]
severity: high
---
# A directory scan is not an atomic storage snapshot

## PROBLEM

A storage sweeper lists files, stats them, and totals their sizes while another process publishes chunks or atomically replaces metadata. Each filesystem operation succeeds on its own, but the sequence is not a snapshot. A listed temporary file can be renamed before `lstat`, a preallocated chunk can shrink before publication, and an opened manifest can become unlinked when its replacement takes the pathname.

Treating every such change as corruption disables healthy storage. Ignoring every `ENOENT` is the opposite failure: it reports an incomplete sum as exact and can release capacity that a live writer still owns.

A second race appears when accounting combines independent scans. Suppose the whole-tree scan sees 8 MiB of an active attempt, then the attempt scan sees 12 MiB. For a 32 MiB reservation, `8 + (32 - 12)` charges only 28 MiB. If the attempt shrinks between those scans, subtracting the later known bytes from the earlier whole-tree total invents "unknown" data and can falsely quarantine valid storage. Both formulas look correct when all files are stationary.

These defects were independently reproduced in a diagnostics spool. The original production periodic-task exception had been swallowed, so its exact class remained unknown. The reproductions establish real defects and regression cases; they do not identify that missing historical exception.

## WRONG

```js
for (const name of await readdir(dir)) {
  try { total += (await lstat(join(dir, name))).blocks * 512; }
  catch (error) {
    if (error.code === "ENOENT") continue; // Incomplete measurement called exact.
    throw error;
  }
}

const whole = await footprint(root);        // Earlier observation.
const used = await footprint(activeDir);    // Later observation of the SAME bytes.
const accounted = whole + Math.max(0, reservation - used);
const unknown = Math.max(0, whole - used);  // Can invent quarantine after shrink.
```

Starting a probe timeout only after entering a mutex is also insufficient: an indefinitely queued probe never reaches its supposedly bounded operation.

## RIGHT

Classify each root entry once and derive a known attempt's measured allocation and remaining reservation from the **same measurement result**. Charge unknown entries independently instead of discovering them by subtracting measurements taken at different times. Serialize accounting and lease decisions, while recognizing that the external writer can still publish during the scan.

```text
for each root entry, under the accounting lifecycle gate:
  if it is a known attempt:
    measure that attempt once using its live-or-stable protocol
    charge measured storage from that result
    if its reservation is still held:
      also charge max(0, reservation limit - measured allocation)
  else:
    measure and charge it through strict unknown-data handling
add root overhead and reserved metadata/replacement headroom
```

The live protocol is a narrow exception, not a forgiving generic walker:

1. Require a registered, owned live writer and a held reservation. Accept only the publication protocol's controlled names. Validate directory identity/ownership and regular-file, no-symlink, no-hardlink constraints.
2. Compare file identity and allocation observations, plus directory identity and changes, around the scan. A missing **controlled temporary** can mean publish or cancel; restart the measurement rather than omit it. Do not assume every removed partial has a finalized counterpart: an empty canceled partial may simply disappear.
3. Bound retries, entries, and depth. The verified correction allowed three scans and shared one entry budget across attempts, retries, and strict sibling scans. Repeated controlled change returns **measurement deferred**, not zero bytes, an exact result, or proof of an overrun.
4. On deferral, retain the last validated measurement and the **full active quota reservation**. Keep the stale/deferred status visible. If no safe prior basis exists, refuse admission rather than invent one. Free-space admission must also reserve a conservative full allowance while measurements are deferred, not credit a stale estimate of already-written bytes.
5. Missing stable files or attempt directories, unknown filenames/writers, unsafe inodes, and real per-file or aggregate overflow remain failures. Do not broaden the live exception to settled or quarantined data. Release a reservation only after the normal writer-close and reconciliation proof.

This protocol does not make the filesystem transactional. Deferring safely depends on exclusive writer ownership and an independently enforced allocation limit; a last-known size alone cannot bound an uncontrolled writer. A directory timestamp alone also misses in-place file changes.

For a specifically controlled, atomically replaced live manifest, an open descriptor with link count zero can be the old, otherwise safe inode. Close it and reopen the controlled path with a bounded retry, rechecking ownership, regular-file status and size. Keep the generic metadata reader strict, and do not interpret repeated replacement or temporary absence as writer completion.

Start the probe's deadline **before queueing for the accounting gate**. Its watchdog must stop the capture if queue wait consumes the budget; the queued callback must recheck stopped/closed state before performing work or renewing a lease. Keep finalization outside a gate it must acquire itself. A timeout or deferred measurement must not silently free the writer's reservation.

## NOTES

- Verification: 22 deterministic race/safety cases cover rename between listing and inspection, growth/shrink between scans, canceled partials, repeated instability, live-manifest replacement, strict negative controls, and lock-queue timeout. The tests use explicit publication hooks rather than hoping a timing race occurs.
- An isolated packaged-runtime stress test completed **1,155 nonoverlapping sweeps**, including **five publication events during sweeps**, across **two complete captures**. It recorded **zero readiness, sweep, or accounting failures** and a clean shutdown. Only the local fixture's sweep interval was accelerated; these are bounded test observations, not proof that every schedule is covered.
- Preserve bounded failure metadata such as operation, normalized error code, and timestamp. A catch that sets only `cleanup_failed` discards the evidence needed to distinguish a publication race from an unrelated storage fault. Keep paths, private identifiers, and payloads out of public diagnostics and lessons.
- Implementation evidence: TCG commit [b1963df](https://github.com/BoardPandas/tcg/commit/b1963dfcf837c43a8c41506fce4396a6dcc2920b), particularly `diagnostics-fs.mjs`, `diagnostics-store.mjs`, `diagnostics-capture.mjs`, and the 22-case `diagnostics-store-races.test.mjs` suite.
- Related: [XFS file length does not enforce a physical disk cap](../linux/file-length-does-not-enforce-physical-disk-cap-xfs.md) covers the independent allocation-limit prerequisite; this lesson covers concurrent measurement and reservations. [Parent-directory mtime misses file edits](../nodejs/parent-dir-mtime-misses-file-edits.md) explains why one directory timestamp is insufficient. [Tracked-but-missing source files](../nodejs/git-ls-files-missing-on-disk.md) can legitimately be skipped by a tooling scan; that policy must not be copied into quota accounting.
