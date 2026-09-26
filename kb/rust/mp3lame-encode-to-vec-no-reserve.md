---
tech: rust
tags: [mp3lame-encoder, lame, mp3, ffi, buffer-overflow, audio]
severity: high
---
# mp3lame-encoder encode_to_vec does not reserve: LAME treats a 0-byte buffer as unbounded

## PROBLEM
`mp3lame_encoder::Encoder::encode_to_vec` / `flush_to_vec` (0.2.x) pass the Vec's *spare capacity* to `lame_encode_buffer*` and never reserve. LAME's contract is that an output size of 0 means "assume the buffer is large enough", so an empty (or exactly full) Vec lets LAME write past the allocation: heap corruption or an access violation (observed: segfault on the first encode). The `_to_vec` name reads like a growing API; it is not.

## WRONG
```rust
let mut out = Vec::new();
enc.encode_to_vec(MonoPcm(chunk), &mut out)?; // spare capacity 0 -> unbounded write
enc.flush_to_vec::<FlushNoGap>(&mut out)?;
```

## RIGHT
```rust
let mut out = Vec::new();
out.reserve(mp3lame_encoder::max_required_buffer_size(chunk.len()));
enc.encode_to_vec(MonoPcm(chunk), &mut out)?;
out.reserve(7200); // LAME's documented worst case for a flush
enc.flush_to_vec::<FlushNoGap>(&mut out)?;
```

## NOTES
Reserve before EVERY call, not once. The raw `encode`/`flush` taking `&mut [MaybeUninit<u8>]` have the same trap: never pass an empty slice. Once fixed, 1 h of 16 kHz stereo at 64 kbps encodes in ~5 s.
