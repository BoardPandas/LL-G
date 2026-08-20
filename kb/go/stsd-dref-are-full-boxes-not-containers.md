---
tech: go
tags: [mp4, iso-bmff, fmp4, parsing, binary-formats, h264]
severity: medium
---
# `stsd` and `dref` are ISO-BMFF full boxes, so a generic box walker cannot descend into them

## PROBLEM

Writing or testing an MP4/fMP4 muxer usually means writing a small recursive box
walker: read a 4-byte big-endian size, read a 4-byte type, and if the type is a
known container, recurse into its payload. That works for `moov`, `trak`,
`mdia`, `minf`, `stbl`, `dinf`, `mvex`, `moof` and `traf`.

It does **not** work for `stsd` or `dref`, and they look like containers because
they hold child boxes. Both are *full boxes with an entry count*: their payload
begins with a 1-byte version, 3 bytes of flags, and a 4-byte entry count, and
only then do the children start. Recursing at offset 0 reads
`version|flags|count` as a box size and the first four bytes of the sample entry
as a box type -- so the walk either fails with an impossible size or, worse,
succeeds against garbage.

The practical symptom is a test that cannot find `avc1` even though the writer
emitted it, and a stack of assertions about the sample entry that never run.
Chasing it in the writer is the wrong direction: the bytes are usually right and
the reader is wrong.

## WRONG

```go
var containerBoxes = map[string]bool{
    "moov": true, "trak": true, "mdia": true, "minf": true, "stbl": true,
    "dinf": true, "mvex": true, "moof": true, "traf": true,
    "stsd": true, // <-- not a container: version|flags|entry_count come first
}

// ...and then, in a test:
avc1 := mustFind(t, boxes, "avc1")
//   no "avc1" box in: ftyp moov(mvhd trak(tkhd mdia(mdhd hdlr minf(...
```

## RIGHT

```go
// Leave stsd and dref out of the container set, and give each a reader that
// skips its own fields first.
func sampleEntry(t *testing.T, boxes []parsedBox) parsedBox {
    t.Helper()
    stsd := mustFind(t, boxes, "stsd")
    if len(stsd.Payload) < 8 {
        t.Fatalf("stsd payload is %d bytes: no entry count", len(stsd.Payload))
    }
    // 4 bytes version+flags, then the entry count, then the children.
    if count := binary.BigEndian.Uint32(stsd.Payload[4:]); count != 1 {
        t.Fatalf("stsd lists %d entries, want 1", count)
    }
    entries, err := parseBoxes(stsd.Payload[8:], stsd.Offset+16)
    if err != nil {
        t.Fatalf("parsing the sample entry: %v", err)
    }
    return entries[0]
}
```

And note that `avcC` is not reachable by walking either: it sits inside `avc1`'s
payload *after* 78 bytes of fixed-width `VisualSampleEntry` fields (reserved,
data_reference_index, width, height, resolutions, frame_count, a 32-byte
compressorname, depth, pre_defined). Search the bytes for it rather than
pretending `avc1` is a container:

```go
at := bytes.Index(avc1.Payload, []byte("avcC"))
record := avc1.Payload[at+4:]
if record[4]&0x03 != 3 {
    t.Errorf("avcC lengthSizeMinusOne = %d, want 3 to match four-byte NAL prefixes", record[4]&0x03)
}
```

## NOTES

- Make the walker return an error rather than calling `t.Fatalf`, so the walker
  itself can be tested against a box that declares more bytes than exist. A
  walker that silently truncates makes every structural assertion above it pass
  on a file no player can open. `t.Fatalf` inside a helper called from a
  zero-value `&testing.T{}` panics rather than failing, so it cannot be
  self-tested that way.
- Other full boxes with leading fields, for the same reason: `stts`, `stsc`,
  `stsz`, `stco`, `elst`, `iref`. They hold no child boxes so they rarely bite,
  but the same offset arithmetic applies if you read their entries.
- Related, in the same family of "the container is fine, the reader is wrong":
  `lengthSizeMinusOne` in `avcC` must match the NAL length prefix width the
  samples actually use (4 bytes for `annexBToAVCC`-style output). A mismatch
  decodes as noise with no error anywhere.
