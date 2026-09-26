---
tech: gemini
tags: [gemini, audio, transcription, diarization, long-audio, structured-output, interactions-api]
severity: high
---
# Gemini stops early on long audio and returns a complete-looking transcript

## PROBLEM
Asked to transcribe 30 min of audio with timestamps and speaker labels (gemini-3.6-flash, Interactions API, JSON schema output), Gemini returned well-formed JSON covering only the first ~2 minutes: no error, no truncation flag, 626 output tokens. A stricter "transcribe everything" prompt reached only 63-71% of turns, ~45% of them mislabelled. It also merges multi-channel audio to mono (a stereo "left = me, right = them" file mislabelled 3/10 turns), and speaker numbers are per request, so "Speaker 1" swaps between chunks. Short clips (1-5 min) look perfect, which hides all of this in early testing.

## WRONG
```text
one request: stereo file (L = local user, R = remote), 30-60 min,
"label left as me, right as them, number the remote speakers" -> trust the JSON
```

## RIGHT
```text
- one TRACK per request: identity comes from which file you sent, never from the model
- ~5-minute windows; per window: 100% of turns, labels consistent, starts within ~0.3 s
- validate coverage: last segment end vs audio length, words per minute; clamp end times
  (seen: a 102 s end time in a 63 s clip)
- link speakers across windows yourself (overlap matching); reference voice clips in the
  prompt fixed one window and broke another
- if exact diarization matters, use an ASR with native multichannel + diarization
  (Deepgram nova-3 on the same 30 min: 100% of turns, 0 channel errors, 6.7 s)
```

## NOTES
Measured 25 audio tokens/s billed (1581 tokens for 63.2 s), not the documented 32. Files API: resumable upload, MP3 is ACTIVE immediately, reference it as `{type:"audio", uri, mime_type}` in Interactions `input[]`, and DELETE after use (48 h retention). Found in Hark meetings CP0 (2026-09-26).
