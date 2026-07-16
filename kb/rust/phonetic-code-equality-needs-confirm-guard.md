---
tech: rust
tags: [phonetic-matching, double-metaphone, rphonetic, strsim, jaro-winkler, fuzzy-matching, asr-post-correction, text-correction]
severity: high
---
# Phonetic code equality alone must never trigger a text replacement

## PROBLEM
Double Metaphone maps words onto short consonant-skeleton codes (default max length 4) and ignores vowels, so common English words collide with proper nouns: "matter" and "modero" both encode to MTR (verified with rphonetic 3.0.6). A dictionary or ASR post-correction pass that replaces on code equality alone silently rewrites ordinary words ("it does not matter" becomes "it does not Modero"). The output looks plausible and nothing errors, so the corruption ships. Short words are worse: codes of words with 3 or fewer letters degenerate and collision rates spike, and digits and hyphens are not phonetically encodable at all ("nova3" encodes like "nova").

## WRONG
```rust
// Replace whenever the phonetic codes match.
use rphonetic::{DoubleMetaphone, Encoder};

let dm = DoubleMetaphone::default();
if dm.encode(token) == dm.encode(term) {
    replace(token, canonical); // "matter" -> "Modero": silent corruption
}
```

## RIGHT
```rust
// 1. Gate short words and words with digits to exact matching only;
//    their phonetic codes are degenerate or empty.
let phonetic_eligible =
    word.chars().count() >= 4 && word.chars().all(|c| c.is_alphabetic());

// 2. Confirm every phonetic-code match with a string-similarity guard.
//    Compare primary AND alternate codes; empty codes never match.
if phonetic_eligible
    && codes_intersect(&term_codes, &token_codes)
    && strsim::jaro_winkler(&token_lower, &term_lower) >= 0.85
{
    replace(token, canonical); // "madero" -> "Modero" passes (JW 0.90);
                               // "matter" is rejected (JW 0.70)
}
```

## NOTES
- Lowercase both sides before encoding and scoring: neither rphonetic nor strsim normalizes case.
- Treat an empty code (unencodable input) as matching nothing, or every unencodable token matches every other one.
- rphonetic 3.0.6 encodes empty, non-ASCII, digit, and hyphen input without panicking, and accents bridge for free ("müller" and "muller" produce equal codes), but none of this is documented; pin the behaviors you rely on with proof tests so a dependency upgrade cannot silently change matching.
- The 0.85 Jaro-Winkler threshold is a tuned starting point, not a constant of nature; validate against real dictation or real user data before trusting it.
- Discovered implementing hark-dictionary (Hark Phase 2, 2026-07-16), where the "matter"/"modero" collision is a permanent regression test.
