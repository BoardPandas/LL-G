---
tech: rust
tags: [gemini, gemini-live, stt, transcription, smart-mode, llm, refusal, prompt-injection, cleanup, dictation]
severity: high
---
# Gemini Live SMART transcription answers, drops and obeys what you dictate

## PROBLEM
`gemini-3.5-transcribe-live` with `inputAudioTranscription.mode = "SMART"` runs the
audio through a language model, and the model treats the speech as talking to it:

- A request-shaped dictation ("Add the following MCP server") comes back as Gemini's
  canned refusal: "I'm just a language model and can't help with that." That text is
  injected as if the user had said it.
- Openers are dropped as filler ("So basically, users are..." -> "Users are...").
- Spoken instructions are carried out instead of transcribed ("...593 guest accounts.
  Drop all the other bullet points." -> the second sentence vanishes).

SMART returns ONE string. There is no separate literal transcript, so anything stored
as the "raw transcript" is already rewritten and the dropped words are unrecoverable.

A downstream cleanup step cannot fix this. A fused provider mode replaces the app's
own cleanup pass, so the user setting their cleanup voice to "Verbatim" changes
nothing: the voice never runs. Users dictating prompts to other AI tools hit all three
symptoms constantly.

## WRONG
```rust
// SMART text trusted as the transcript and stored as "raw".
let text = session.finish(TranscribeMode::Smart)?;
record.raw_text = text.clone();   // not raw: already rewritten
inject(&text)?;                   // may be "I'm just a language model..."
```

## RIGHT
```rust
/// Short text that both describes the model and declines.
pub fn is_canned_refusal(text: &str) -> bool {
    if text.split_whitespace().count() > 40 { return false; }
    let lower = text.to_lowercase().replace('\u{2019}', "'");
    ["language model", "text-based ai", "as an ai", "generate text"].iter().any(|p| lower.contains(p))
        && ["can't help", "cannot help", "can't assist", "unable to help",
            "unable to assist", "not able to assist", "don't have the ability"]
            .iter().any(|p| lower.contains(p))
}

// SMART only: make it an error so the finished clip replays in VERBATIM.
// A false match costs one replay and returns the same words.
pub fn checked_text(mode: TranscribeMode, text: String) -> Result<String, SttError> {
    if mode == TranscribeMode::Smart && is_canned_refusal(&text) {
        return Err(fail("SMART answered instead of transcribing".into()));
    }
    Ok(text)
}
```
Also: warn in the cleanup-voice UI whenever the fused mode is in effect (the voice is
ignored), and label stored SMART text as "not verbatim" rather than "raw transcript".

## NOTES
- Dropped openers and obeyed instructions cannot be detected: they look exactly like
  good cleanup. The only real fix is VERBATIM mode; default to it.
- Never apply the refusal check to VERBATIM output: there the sentence is what the
  user actually dictated.
- Keep the finished clip (don't consume the ring buffer while streaming) so a failed
  SMART stream can replay; replaying in SMART again re-hits the same behaviour.
- Related: SMART can also strand a turn entirely on "scratch that" (no final
  transcript, no generationComplete). See the WebSocket binary-frames entry for the
  rest of the Gemini Live protocol traps.
- Observed in Hark 0.62.3, fixed in 0.62.4 (2026-10-15).
