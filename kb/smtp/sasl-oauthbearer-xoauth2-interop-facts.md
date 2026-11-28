---
tech: smtp
tags: [sasl, oauthbearer, xoauth2, rfc-7628, gs2-header, imap, smtp-auth, fuzzing, corpus]
severity: medium
---
# SASL OAUTHBEARER / XOAUTH2 interop facts: RFC 7628's example GS2 header is invalid, XOAUTH2 clients acknowledge failure with an empty line, and fuzz targets need a seeded corpus

## PROBLEM
Four facts that cost time when implementing OAuth SASL mechanisms for SMTP or IMAP:

1. **RFC 7628 section 4.4's example has an invalid GS2 header.** A parser that is correct for the GS2 header grammar rejects the RFC's own example, and a parser written to accept the example is wrong. Do not use that example as a test vector for strict parsing.
2. **XOAUTH2 clients acknowledge a failure with an empty line.** After the server's failure challenge, an OAUTHBEARER client sends the dummy response `AQ==` (a single 0x01 byte); an XOAUTH2 client sends an empty response instead. A server that waits for `AQ==` from an XOAUTH2 client mishandles the exchange.
3. **Google's failure JSON uses HTTP status strings.** In the XOAUTH2 error challenge the `status` member is an HTTP status as a string (for example `"401"`), not the RFC 7628 style of error name (`"invalid_token"`). Clients written against Google's format may expect it.
4. **Fuzz targets for exact-format secrets need a seeded corpus.** A fuzzer almost never generates a syntactically valid initial response by chance, so without seeds it only ever exercises the reject path and reports nothing.

## WRONG
```text
- Use the RFC 7628 section 4.4 example as the "must accept" vector for a strict GS2 parser.
- After a failure challenge, require exactly "AQ==" for both mechanisms.
- Start a fuzz target for the SASL parser with an empty corpus and read "no crashes" as coverage.
```

## RIGHT
```text
- Build GS2 test vectors from the grammar; note the RFC example as a known-bad case.
- After a failure challenge accept "AQ==" (OAUTHBEARER) and an empty line (XOAUTH2),
  then answer with the final failure.
- Decide deliberately which failure JSON each mechanism returns, and test with real clients.
- Seed the fuzz corpus with valid initial responses for each mechanism, so mutations start
  from the accept path.
```

## NOTES
- Mechanism choice is the client's: see `kb/github-actions/tests-asserting-system-tool-output-fail-on-older-ci-image.md` for a curl version that sends OAUTHBEARER even when asked for XOAUTH2.
