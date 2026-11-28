---
tech: smtp
tags: [smtp-smuggling, bare-cr, bare-lf, data, end-of-data, crlf, submission, relay]
severity: high
---
# Never normalise or forward a bare CR or LF in message data (SMTP smuggling)

## PROBLEM
The end of an SMTP message is exactly `CRLF . CRLF`. Servers that are lenient about line endings disagree with each other about sequences such as `LF . LF`, `CR . CR` or `LF . CRLF`: one treats it as message content, the next as end of data. A sender can then hide a complete second message (with its own `MAIL FROM` and headers) inside what the first server saw as one message body. The second server delivers it as a separate message that appears to come from, and may be authenticated as, the first server's domain.

A server takes part in this whenever it either **normalises** bare CR or LF to CRLF, or **forwards** them unchanged to the next hop.

## WRONG
```text
- Accept LF as a line ending and rewrite it to CRLF "to be tolerant".
- Pass message bytes through untouched, bare CR/LF included.
- Treat <LF>.<LF> or <CR>.<CR> as end of data.
```

## RIGHT
```text
- End of data is exactly CRLF "." CRLF. Nothing else terminates a message.
- A bare CR or a bare LF anywhere in message data: refuse the message (5xx).
- A dot line next to a bare CR or LF (an attempted alternative terminator): refuse the
  message AND close the connection, because the two sides may no longer agree on
  where commands resume.
```

## NOTES
- Refusing is the only safe choice; "fixing" the line endings is the vulnerable behaviour.
- Test with each combination of CR, LF and `.` around the terminator, on the first line and mid-message.
- Related: `smtp-proto-0-2-5-request-parser-and-data-receiver-quirks.md` (a DATA receiver that ends on `.\r\r\n`).
