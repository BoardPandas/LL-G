---
tech: rust
tags: [audio, dsp, rms, vad, silence-gate, cpal, threshold, push-to-talk]
severity: high
---
# A mean-RMS silence gate over a padded audio window is utterance-length dependent

## PROBLEM
Capture pipelines pad each clip: pre-roll before the trigger (to catch words started early) and a tail after release (to catch trailing syllables). If the "is this speech?" gate then compares the **mean** RMS of that whole assembled buffer against a fixed threshold, the padding is counted as signal.

RMS is a mean, so it falls as the *proportion* of the clip that is silence rises. The gate passes only if `speech_rms * sqrt(speech_fraction) >= threshold`, which means the **effective threshold rises as utterances get shorter**. With 300 ms pre-roll + 150 ms tail and a 0.01 threshold:

| Utterance | Speech fraction | Speech RMS needed |
|---|---:|---:|
| 3 s sentence | 0.87 | 0.0107 (-39.4 dBFS) |
| 1 s hold | 0.69 | 0.0120 (-38.4 dBFS) |
| 0.4 s "yes" | 0.29 | 0.0184 (-34.7 dBFS) |
| 0.7 s, pause then one word | 0.26 | 0.0196 (-34.2 dBFS) |

So the gate is strictest on short commands and on users who press-then-think — the highest-frequency interactions in push-to-talk. It is also silent: the clip is discarded, nothing is sent, and the user sees the app do nothing.

This shipped. Users reported having to lean into the microphone, while the same microphone worked fine in Teams/Zoom/Discord (those run AGC and were compensating). Long sentences worked, so it did not look like a level problem; leaning in was the only variable the user controlled, so it looked like a range problem.

The threshold being **absolute** compounds it: it encodes an assumption about how hot the user's hardware is, and anyone below that assumption gets silence.

## WRONG
```rust
/// Mean RMS of the whole assembled window (pre-roll + hold + tail).
pub fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() { return 0.0; }
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
}

pub fn gate_clip(samples: &[f32], params: &WindowParams) -> GateVerdict {
    // Padding and pauses drag this mean down, so the same voice at the same
    // level passes or fails depending on how long the user spoke.
    if rms(samples) < params.silence_rms {
        GateVerdict::TooQuiet
    } else {
        GateVerdict::Speech
    }
}
```

## RIGHT
```rust
/// RMS of the LOUDEST window in the clip: "did this ever reach speaking
/// level?", which no amount of surrounding silence can change.
/// 2n multiply-adds, no allocation (each sample lands in <= 2 windows).
pub fn peak_window_rms(samples: &[f32], rate: u32, window_ms: u32) -> f32 {
    let win = ms_to_samples(window_ms, rate) as usize;
    if win == 0 || samples.len() <= win {
        return rms(samples); // nothing to slide
    }
    let hop = (win / 2).max(1); // half-window hops: no burst straddles a boundary
    let mut peak = 0.0f32;
    let mut start = 0;
    while start + win <= samples.len() {
        // f64 accumulator: an f32 sum loses small squares over millions of samples.
        let sum: f64 = samples[start..start + win]
            .iter()
            .map(|&s| (s as f64) * (s as f64))
            .sum();
        peak = peak.max((sum / win as f64).sqrt() as f32);
        start += hop;
    }
    peak
}

pub fn gate_clip(samples: &[f32], rate: u32, params: &WindowParams) -> GateVerdict {
    let (floor, peak) = window_rms_extremes(samples, rate, GATE_WINDOW_MS);
    // OR, never AND: the relative path can only ADMIT clips the absolute
    // threshold would have dropped, so this can never regress a working setup.
    let loud_enough = peak >= params.silence_rms;
    let above_the_room = peak >= DEAD_MIC_RMS && peak >= floor * SPEECH_OVER_ROOM;
    if loud_enough || above_the_room { GateVerdict::Speech } else { GateVerdict::TooQuiet }
}
```

## NOTES
- **Regression test the invariant, not the threshold.** Assert that the same speech level embedded in different amounts of padding yields the same verdict *and* the same measured loudness. Assert too that the old statistic would have split them, so the test proves it still reproduces the original defect.
- **Estimate the noise floor from the quietest window of the whole clip, not from the pre-roll.** Pre-roll exists precisely to catch words the user started early, so it is the one region that cannot be assumed silent.
- **A uniform clip has no noise floor to find.** If you use the floor to cap a normalization gain, note that in a steady clip the quietest window *is* the signal — capping on it starves exactly the quiet clips that need lifting. Only trust the floor as noise when it sits clearly below the peak (e.g. `floor * 2.0 < peak`).
- **Tune cost-protection gates toward passing.** This gate existed to avoid wasted API spend (Groq bills a 10 s minimum per request). A false pass costs one cheap request; a false drop is the product silently not working, which the user cannot diagnose. The asymmetry should be explicit in the code, or someone will "tighten" it back.
- **Log the number that decided the verdict** (measured loudness, noise floor, threshold). "Too quiet" without the measurement cannot distinguish a muted mic from a threshold set too high, and no user report can resolve it.
- Related: [rubato 4.0 whole-clip resampling](rubato-4-whole-clip-process-all.md) — a resampler that leaves the FFT startup delay in produces *leading silence and a truncated tail*, which presents as clipped first syllables and is easily misdiagnosed as this same "gate too strict" problem.
