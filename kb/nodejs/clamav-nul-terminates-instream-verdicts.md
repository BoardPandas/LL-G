---
tech: nodejs
tags: [clamav, clamd, tcp, protocol, attachments]
severity: medium
---
# ClamAV NUL-terminates INSTREAM verdicts

## PROBLEM
The clamd INSTREAM protocol returns verdicts such as `stream: OK` and
`stream: Eicar-Signature FOUND` with a trailing NUL byte. JavaScript's
`String.prototype.trim()` does not remove NUL, so an otherwise reasonable
`/OK$/` or `/FOUND$/` parser rejects valid production responses. A socket PING
still succeeds, which can make the scanner look healthy while every real scan
fails.

## WRONG
```typescript
const response = chunks.join('').trim();
if (/OK$/.test(response)) return { clean: true };
if (/FOUND$/.test(response)) return { clean: false };
throw new Error(`unexpected response: ${response}`);
```

## RIGHT
```typescript
const response = chunks.join('').replace(/\0/g, '').trim();
if (/OK$/.test(response)) return { clean: true };
if (/FOUND$/.test(response)) return { clean: false };
throw new Error(`unexpected response: ${response}`);
```

## NOTES
Test the actual INSTREAM command, not only PING. Include the protocol terminator
in clean and infected regression fixtures so a parser cannot accidentally pass
against a response shape clamd never emits.
