---
tech: go
tags: [testing, fixtures, vacuous-tests, mutation-testing, false-green]
severity: high
---
# A test that asserts properties of a *sequence* proves nothing when the fixture makes one element

## PROBLEM

Assertions of the form "element N+1 follows element N" -- monotonic counters,
cumulative offsets, non-overlapping ranges, ordering, "the next one starts where
the last one ended" -- are all **vacuously true on a collection of one**. The
loop body never executes, `t.Errorf` is never reached, and the test reports
PASS.

This is not the same mistake as forgetting to assert. The assertions are there,
they are correct, and they would catch the bug -- against a fixture that
produces more than one element. The fixture is what is wrong, and nothing about
a green run distinguishes the two.

Observed 2026-08-20 in a fragmented-MP4 muxer. Six tests covered fragment
sequence numbers, cumulative decode times (`tfdt`), per-fragment data offsets
(`trun`), and sample-size totals. The fixture was "one keyframe followed by 400
predicted frames" -- which is exactly **one** fragment, because a new fragment
only opens at a keyframe. Every cross-fragment assertion held over an empty
loop.

A real defect lived underneath: the writer never advanced the fragment's base
decode time, so every fragment after the first would have claimed to start at
zero -- a recording that plays with the picture frozen and the clock running.
The suite was green. It was only found by deliberately mutating the line and
noticing that **no test failed**.

Coverage does not help: the lines all execute. `go vet` does not help. The only
signals are mutation testing, or a fixture guard.

## WRONG

```go
// The fixture. One keyframe, then predicted frames -> exactly one fragment.
func steadyStream(count int) []Sample {
    samples := []Sample{keyframeSample(frame30)}
    for range count {
        samples = append(samples, deltaSample(frame30))
    }
    return samples
}

func fragmentsOf(t *testing.T, boxes []parsedBox) []fragment {
    var out []fragment
    // ...collect moof/mdat pairs...
    if len(out) == 0 {
        t.Fatal("no fragments in the file")   // only guards against ZERO
    }
    return out
}

func TestFragmentsCoverTheTimelineWithoutOverlapOrGap(t *testing.T) {
    _, boxes, _ := writeStream(t, steadyStream(400))

    var expected uint64
    for i, frag := range fragmentsOf(t, boxes) {   // runs once
        got := baseDecodeTime(t, frag)
        if got != expected {                       // 0 == 0
            t.Errorf("fragment %d starts at %d ticks, want %d", i, got, expected)
        }
        expected += durationOf(t, frag)
    }
}   // PASS, against a muxer that never advances the decode time
```

## RIGHT

```go
// 1. Make the fixture produce the shape the assertions are about.
const keyframeInterval = 90 // three seconds at 30fps, past minFragmentDuration

func steadyStream(count int) []Sample {
    samples := make([]Sample, 0, count+1)
    for i := range count + 1 {
        if i%keyframeInterval == 0 {
            samples = append(samples, keyframeSample(frame30))
        } else {
            samples = append(samples, deltaSample(frame30))
        }
    }
    return samples
}

// 2. Guard the arity where every such test reaches for it, so a future fixture
//    change cannot quietly return the suite to vacuity.
func fragmentsOf(t *testing.T, boxes []parsedBox) []fragment {
    t.Helper()
    var out []fragment
    // ...collect moof/mdat pairs...
    if len(out) < 2 {
        // Every assertion about numbering, decode times and offsets is vacuous
        // on a single fragment. A test that reaches here is testing nothing,
        // whatever it goes on to check.
        t.Fatalf("the file has %d fragment(s); these assertions need at least two", len(out))
    }
    return out
}

// 3. Keep a separate, explicitly-named path for the genuine one-element cases.
func oneFragment(t *testing.T, boxes []parsedBox) fragment { /* ... */ }
```

Then prove the tests bite, by breaking the code on purpose:

```bash
# Revert each mutation afterwards. Untracked files: back them up first --
# `git checkout` cannot restore a file git has never seen.
sed -i 's/w.fragmentStart = ticks(w.elapsed)/_ = w.fragmentStart/' writer.go
go test ./internal/recording/ | grep -E "^--- FAIL"
#   --- FAIL: TestFragmentsCoverTheTimelineWithoutOverlapOrGap
#       fragment 1 starts at 0 ticks, want 273000
```

## NOTES

- The tell is structural and greppable: any test whose body is
  `for i := 1; i < len(xs); i++` or that accumulates across a loop needs a
  fixture assertion that `len(xs) >= 2`. Put the guard in the shared helper,
  not in each test.
- `t.Fatalf` on a too-small fixture, not `t.Skip`. A skipped test reads as
  "not applicable here"; this one is "this test is lying".
- Mutation testing is the general answer and does not need a framework: change
  one line, run, confirm a *named* test fails, revert. Five minutes per
  load-bearing invariant. In the case above it caught one real bug out of nine
  mutations tried, and the other eight confirmed the suite was doing its job.
- Same shape in other languages and other domains: paginated results with one
  page, retry schedules with one attempt, diffs with one hunk, migrations with
  one step.
