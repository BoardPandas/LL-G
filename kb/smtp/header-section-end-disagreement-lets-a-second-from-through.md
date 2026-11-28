---
tech: smtp
tags: [mail-parser, rust, header-injection, from-spoofing, dkim, form-feed, encoded-word, rfc-5322, submission, parser-differential]
severity: high
---
# A mail parser and a downstream reader can disagree about where the header section ends, so a second From passes a single-From check

## PROBLEM
A submission server checks that a message has exactly one `From:` and that the sender owns that address, using a MIME parser's view of the headers. If the parser and the software that later reads the message disagree about where the header section ends, the check covers only part of what the recipient's software treats as headers.

Concrete case with the Rust `mail-parser` crate: it treats **form feed** (`\f`) as line space, so a line holding only `\f` ends its header section. Other software does not see that line as blank and keeps reading headers. A second `From:` placed after it, naming another sender, is body text to the parser (so the single-From ownership check passes) and a header to downstream readers. The server then sends the message **DKIM-signed** by the victim domain.

A related surprise in the same parser: it decodes encoded-words **inside angle brackets** (`<=?utf-8?q?...?=@host>`), so the address the check sees is not the address on the wire.

## WRONG
```text
From: me@example.com
Subject: hello
\f                                  <- the parser ends the header section here
From: ceo@victim.example             <- body to the parser, a header downstream

check(parser.headers("From")) == ["me@example.com"]   -> owned, accept, sign, send
```

## RIGHT
```text
Before trusting the parser, validate the header section at the byte level:
  - find its end yourself: the first empty line (CRLF CRLF), nothing else
  - every line is a field ("name:" with valid field-name characters) or a folded continuation
  - no control characters other than the CRLF and tab/space folding allows
  - originator fields (From, Sender, ...) are unique
Then require agreement with the parser:
  - the parser's header section ends at the same byte offset
  - the parser's From address equals the address in the raw bytes (no decoding inside <...>)
Refuse the message on any disagreement.
```

## NOTES
- The class of bug is a parser differential: any byte that one reader treats as "blank line" or "line space" and another does not is a candidate. Test with form feed, vertical tab, bare CR, bare LF and NUL in the header section.
- Fuzz the validator against the parser: for any input both accept, the header boundary and the From address must agree.
- Related: `bare-cr-or-lf-in-message-data-smtp-smuggling.md` on this shelf.
