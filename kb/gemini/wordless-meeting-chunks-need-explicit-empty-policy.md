---
tech: gemini
tags: [gemini-live, transcription, meetings, silence, timeout, diagnostics]
severity: high
---
# Gemini Live meeting chunks need an explicit policy for wordless turns

## PROBLEM

A meeting chunk can pass a loudness gate because of a cough or keyboard noise
while containing no speech. During Hark's 20-minute Google Meet test, Gemini
Live finalization logged wordless chunks with one frame, zero interims, and
zero final segments. Using the dictation budget classified these as failures:
19 failed chunks, mostly the local participant's near-silent stretches.

## WRONG

```text
Use the dictation finalization budget and error policy for every meeting chunk.
Count every wordless expiration as lost speech.
```

## RIGHT

```text
Give meeting chunks an explicit, bounded finalization policy.
On the opted-in meeting path, accept a wordless expiration as empty only when
no interim or final transcript was observed.
Keep dictation, socket, protocol, and provider errors distinct.
Record frame/interim/final counts, never transcript content.
```

## NOTES

This is Hark's acceptance policy supported by the observed call, not a Gemini
guarantee that every empty response means silence. Hark uses a 15-second
per-frame deadline and 45-second overall ceiling for meeting chunks. A wordless
connection can also indicate a provider or protocol fault; retain diagnostics.

The zero-interim guard describes timeout acceptance. Normal completion has a
separate empty-result branch; do not claim that every empty result in Hark
requires zero interims. Dictation retains its own error policy.

Evidence: [Finalize policies and deadline branches](https://github.com/BoardPandas/Hark/blob/9a61d11d06056d6b54b9ad6f4cd8c4fb1f2fe654/crates/hark-stt/src/gemini_live.rs)
and the second-real-call observations in Hark's meeting plan, section 8.
