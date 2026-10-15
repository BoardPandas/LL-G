---
tech: linux
tags: [xfs, disk-usage, storage-limits, preallocation, fallocate, st-blocks, retention]
severity: high
---
# File length does not enforce a physical disk cap on XFS

## PROBLEM

A diagnostics recorder stopped each gzip chunk at a byte limit and summed file lengths to enforce its disk budget. The counters were correct for logical content, but buffered appends on the tested XFS filesystem allocated blocks beyond the current end of file. The process could exceed its promised physical disk cap while every logical-size check passed.

In the reproduction, a file with **1,048,576 logical bytes occupied 2,031,616 allocated bytes**; another with **2,097,152 logical bytes occupied 4,128,768 allocated bytes**. Allocated bytes were measured using Linux `st_blocks * 512`, not estimated from compression output or `st_size`. These are observed measurements, not a universal XFS multiplier.

Checking allocated blocks after an append detects an overrun after it has happened. Faster sampling, gzip byte counters, and smaller buffers do not turn that into a hard allocation limit. Retention that deletes only finalized files also misses open chunks, atomic-update temporary files, and the space reserved for pending work.

## WRONG

```js
// File length is a content counter, not an allocated-block counter.
const before = await stat(chunkPath);
if (before.size + nextCompressedChunk.length <= chunkLimit) {
  await appendFile(chunkPath, nextCompressedChunk);
}

// Even a correct sum of these values understates this filesystem's allocation.
const usedBytes = files.reduce((sum, file) => sum + file.size, 0);
```

Neither `ftruncate(fd, limit)` alone nor a sparse file proves that storage has been reserved. A fallback that emulates allocation by growing the file with buffered writes can reintroduce the same failure.

## RIGHT

Reserve a fixed, block-aligned capacity before the writer starts. Use native allocation supported by the filesystem, keep EOF fixed while writing inside that capacity, and validate the actual block charge. Refuse capture when the supported allocation contract cannot be established; do not silently fall back to unbounded buffered growth.

```text
Under exclusive ownership of the private spool:
  reserve chunk capacity plus metadata and atomic-update scratch
  create a new regular file exclusively, without following symlinks
  validate filesystem alignment and allocation hints
  reject unsupported extent/COW hints or allocation behavior
  native Linux fallocate(fd, 0, 0, capacity)
  ftruncate(fd, capacity)
  fstat(fd): require st_size == capacity
  fstat(fd): require st_blocks * 512 <= reserved charge

For every write:
  require offset >= 0 and byteCount <= capacity - offset
  write within the preallocated EOF; never append beyond capacity

On completion:
  truncate unused tail
  sync payload, rename the temporary file, sync its directory
  measure actual allocated blocks and reconcile the reservation
```

This is the allocation protocol, not a complete secure allocator. Check every syscall, protect path traversal and ownership, and clean up only the newly created inode on failure. The verified implementation used Linux's native `fallocate`, rather than a libc allocation-emulation fallback, and refused unsupported filesystem checks. It also rejected inherited extent-size/COW allocation hints before allocating because those can round the requested charge upward.

Keep logical bytes, allocated bytes, and held reservations as separate quantities. Account for temporary and finalized chunks, manifests/receipts, directory charge, and maintenance scratch for atomic replacement. Reserve replacement space before admitting another capture; an almost-full spool must still be able to publish its terminal state. Retention must not delete or reuse a live writer's reservation.

## NOTES

- Verified on Linux/XFS in a container-backed private spool on 2026-10-15. After the fixed-EOF change, the writer stress probe took **86 samples**; its peak observed file-block allocation plus metadata reserve was **32,792,576 bytes**, below the **33,554,432-byte (32 MiB)** attempt cap. The probe checked actual allocation while writing, not just final compressed output.
- On Linux, `st_blocks` uses 512-byte units; multiplying it by the filesystem block size would be another accounting error. Block alignment for allocation is a separate value obtained from the filesystem.
- A hard cap needs preventive reservations and a validated allocation path. Sampled success on one filesystem is evidence for that tested configuration, not proof that every XFS mount, reflink state, or other filesystem behaves identically. Fail closed when those prerequisites are unknown.
- This application budget covers its owned files and reserved metadata. It is not a filesystem/project quota and does not bound unrelated writers or all filesystem-internal overhead. Keep a host free-space floor as a separate admission check.
- Regression coverage should reproduce buffered-append over-allocation on the target filesystem, exercise incompressible input and concurrent captures near the global limit, and include metadata replacement, writer failure, and retention while reservations remain live.
