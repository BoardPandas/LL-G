---
tech: aws-ses
tags: [ses, message-id, headers, threading, deduplication, sesv2]
severity: medium
---
# SES overwrites the Message-ID header and does not document the replacement format

## PROBLEM
SES replaces the `Message-ID` header of every message it sends, so the ID your code put in the raw message is not the one recipients see. AWS documents the override but not the format of the replacement. Code that records its own generated `Message-ID` for later matching (threading, reply correlation, deduplicating the inbound copy of a loopback send) never matches what actually arrives.

Observed in `us-east-1` (the only region checked): `<MessageId>@email.amazonses.com`, where `MessageId` is the value `SendEmail` returned. For other regions the form `<MessageId>@<region>.amazonses.com` is a guess and was not verified.

## WRONG
```text
# Generate and store your own Message-ID, then match on it later.
Message-ID: <generated-by-us@example.com>      # in the raw message handed to SES
# Recipient sees a different Message-ID; lookup by the stored value finds nothing.
```

## RIGHT
```text
# 1. Store the MessageId returned by SendEmail (e.g. 0100aaaa-bbbb-cccc-dddd-eeee-000000).
# 2. Derive the wire header from it:  <0100aaaa-...-000000@email.amazonses.com>
# 3. Verify the derivation with a loopback send in the region you use: send to an
#    address you receive, read the inbound Message-ID header, compare it with the
#    derived value, and fail loudly if they differ.
```

## NOTES
- The format is observed behaviour, not a contract. Keep the derivation in one function, keep the loopback check as a test or a diagnostic command, and re-run it after region or account changes.
- Validate the returned ID before building a header from it (printable ASCII, no whitespace, `<`, `>` or `@`).
- Source for the override itself: the SES developer guide page on header fields.
