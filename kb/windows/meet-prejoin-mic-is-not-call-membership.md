---
tech: windows
tags: [windows, consentstore, chrome, google-meet, microphone, detection]
severity: medium
---
# Google Meet can hold the microphone before the user joins the call

## PROBLEM

A microphone-use signal establishes that an application opened the device,
not that the user joined a call. Hark's 2026-09-28 handoff records Chrome
taking the microphone in the Google Meet lobby before joining. Active mic
use plus a browser title containing Meet can therefore satisfy a detector
before call membership begins.

## WRONG

```text
ConsentStore reports Chrome using the mic + a Meet title matches
=> assert that the user joined the call
```

## RIGHT

```text
Treat the signal as meeting-related microphone activity.
Phrase prompts around the observed fact: the app is using your microphone.
Test lobby, joined, hang-up, and remaining-open-tab states separately.
Require a separate signal if actual call membership is essential.
```

## NOTES

The Chrome/ConsentStore observation was supplied in the Hark handoff and was
not independently retested during the documentation audit. Google's
[pre-meeting audio guide](https://support.google.com/meet/answer/10409699?hl=en)
confirms microphone testing before Join now; it does not specify Windows
ConsentStore timing.

Hark's five-second debounce filters brief microphone use, but a lobby open
longer than that can still satisfy detection. Opt-in automatic recording may
therefore include lobby audio; an Ask prompt must not claim confirmed membership.

Evidence: [Hark's detector semantics and title matching](https://github.com/BoardPandas/Hark/blob/9a61d11d06056d6b54b9ad6f4cd8c4fb1f2fe654/crates/hark-meeting/src/detect.rs).
